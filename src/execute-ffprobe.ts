import type { Request, Response } from "express";
import { z } from "zod";
import {
  ffmpegQueue,
  maxConcurrent,
  runFFprobe,
  type ExecuteFfprobeResponse,
  type ErrorResponse,
} from "./lib/ffmpeg-execution.js";
import {
  createRequestWorkspace,
  cleanupRequestWorkspace,
} from "./lib/request-workspace.js";
import { downloadInputs } from "./lib/input-download.js";
import {
  sendCatchError,
  extractUrls,
  replaceUrlsWithPaths,
} from "./lib/handler-utils.js";

export const executeFfprobe = async (
  req: Request,
  res: Response<ExecuteFfprobeResponse | ErrorResponse>
) => {
  const parseResult = executeFfprobeSchema.safeParse(req.body);

  if (!parseResult.success) {
    const details = parseResult.error.issues.map(issue => ({
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

  const { command } = parseResult.data;
  const requestId = res.locals.requestId;

  // Extract arguments by removing 'ffprobe ' prefix
  const args = command.trim().substring(8); // Remove 'ffprobe ' (8 characters)

  // Create request-scoped workspace for downloaded inputs
  const workspace = await createRequestWorkspace(requestId);

  try {
    // Extract HTTP/HTTPS URLs from command arguments
    const inputUrls = extractUrls(args);

    // Download all input files to workspace inputs directory
    let modifiedArgs = args;
    if (inputUrls.length > 0) {
      const downloadedInputs = await downloadInputs(inputUrls, workspace.inputsDir);

      // Replace URLs in args with local file paths
      modifiedArgs = replaceUrlsWithPaths(args, downloadedInputs);
    }

    // eslint-disable-next-line no-console
    console.log(
      `[Queue] Size: ${ffmpegQueue.size}, Pending: ${ffmpegQueue.pending}, Max: ${maxConcurrent}`
    );

    // Add FFprobe execution to shared queue
    const result = await ffmpegQueue.add(() => runFFprobe(modifiedArgs));

    res.json(result);
  } catch (err) {
    sendCatchError(res, err);
  } finally {
    await cleanupRequestWorkspace(requestId);
  }
};

const executeFfprobeSchema = z.object({
  command: z
    .string()
    .min(1)
    .refine(
      (cmd) => {
        const trimmed = cmd.trim();
        return trimmed.startsWith("ffprobe ");
      },
      {
        message: "Command must start with 'ffprobe '",
      }
    ),
});

