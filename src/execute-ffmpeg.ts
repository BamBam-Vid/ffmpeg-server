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
  const requestId = res.locals.requestId;

  // Extract arguments by removing 'ffmpeg ' prefix
  const args = command.trim().substring(7); // Remove 'ffmpeg ' (7 characters)

  // Create request-scoped workspace
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

    // Add FFmpeg execution to queue with workspace outputs directory
    const result = await ffmpegQueue.add(() =>
      runFFmpeg(modifiedArgs, 5 * 60 * 1000, workspace.outputsDir)
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

/**
 * Extracts HTTP/HTTPS URLs from FFmpeg arguments string
 */
function extractUrls(argsString: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s]+/g;
  const matches = argsString.match(urlPattern);

  if (matches) {
    urls.push(...matches);
  }

  return urls;
}

/**
 * Replaces URLs in arguments string with local file paths
 */
function replaceUrlsWithPaths(
  argsString: string,
  downloadedInputs: Array<{ url: string; localPath: string }>
): string {
  let modifiedArgs = argsString;

  for (const input of downloadedInputs) {
    modifiedArgs = modifiedArgs.replace(input.url, input.localPath);
  }

  return modifiedArgs;
}
