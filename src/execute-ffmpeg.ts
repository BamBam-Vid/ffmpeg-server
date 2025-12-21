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

export const executeFfmpeg = async (
  req: Request,
  res: Response<ExecuteFfmpegResponse | ErrorResponse>
) => {
  const parseResult = executeFfmpegSchema.safeParse(req.body);

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

  // Extract arguments by removing 'ffmpeg ' prefix
  const args = command.trim().substring(7); // Remove 'ffmpeg ' (7 characters)

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[Queue] Size: ${ffmpegQueue.size}, Pending: ${ffmpegQueue.pending}, Max: ${maxConcurrent}`
    );

    // Add FFmpeg execution to queue
    const result = await ffmpegQueue.add(() => runFFmpeg(args));
    res.json(result);
  } catch (err) {
    const errorInfo = categorizeError(err);
    res.status(errorInfo.statusCode).json({
      success: false,
      error: errorInfo.message,
      errorType: errorInfo.type,
      ...(errorInfo.exitCode !== undefined && { exitCode: errorInfo.exitCode }),
    });
  }
};

const executeFfmpegSchema = z.object({
  command: z
    .string()
    .min(1)
    .refine(
      (cmd) => {
        const trimmed = cmd.trim();
        return trimmed.startsWith("ffmpeg ");
      },
      {
        message: "Command must start with 'ffmpeg '",
      }
    ),
});
