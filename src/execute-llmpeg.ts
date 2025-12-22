import type { Request, Response } from "express";
import { z } from "zod";
import {
  ffmpegQueue,
  maxConcurrent,
  runFFmpeg,
  categorizeError,
  type ExecuteFfmpegResponse,
  type ErrorResponse,
} from "./lib/ffmpeg-execution.js";
import {
  createRequestWorkspace,
  cleanupRequestWorkspace,
} from "./lib/request-workspace.js";
import { downloadInputs } from "./lib/input-download.js";
import { convertTaskToFFmpegCommand } from "./lib/llmpeg-converter.js";

export const executeLlmpeg = async (
  req: Request,
  res: Response<ExecuteFfmpegResponse | ErrorResponse>
) => {
  const parseResult = executeLlmpegSchema.safeParse(req.body);

  if (!parseResult.success) {
    const details = parseResult.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));

    return res.status(400).json({
      success: false,
      error: "Validation failed",
      errorType: "validation",
      details,
    });
  }

  const { task, inputs } = parseResult.data;
  const requestId = res.locals.requestId;

  // Create request-scoped workspace
  const workspace = await createRequestWorkspace(requestId);

  try {
    // Extract URLs from inputs
    const inputUrls = inputs.map((input) => input.url);

    // Download all input files to workspace inputs directory
    const downloadedInputs = await downloadInputs(inputUrls, workspace.inputsDir);

    // Convert natural language task to FFmpeg command using Claude API
    const { ffmpegCommand } = await convertTaskToFFmpegCommand({
      task,
      downloadedInputs,
    });

    // eslint-disable-next-line no-console
    console.log(
      `[Queue] Size: ${ffmpegQueue.size}, Pending: ${ffmpegQueue.pending}, Max: ${maxConcurrent}`
    );

    // Add FFmpeg execution to queue with workspace outputs directory
    const result = await ffmpegQueue.add(() =>
      runFFmpeg(ffmpegCommand, 5 * 60 * 1000, workspace.outputsDir)
    );

    res.json(result);
  } catch (err) {
    const errorInfo = categorizeError(err);
    res.status(errorInfo.statusCode).json({
      success: false,
      error: errorInfo.message,
      errorType: errorInfo.type,
      ...(errorInfo.exitCode !== undefined && { exitCode: errorInfo.exitCode }),
    });
  } finally {
    // Always cleanup workspace (success or error)
    await cleanupRequestWorkspace(requestId);
  }
};

const executeLlmpegSchema = z.object({
  task: z.string().min(1, "Task description is required"),
  inputs: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.url("Invalid URL format"),
      })
    )
    .min(1, "At least one input file is required"),
});
