import type { Response } from "express";
import { categorizeError, type ErrorResponse } from "./ffmpeg-execution.js";

/**
 * Sends a categorized error response from a caught exception
 */
export const sendCatchError = (res: Response<ErrorResponse>, err: unknown) => {
  const errorInfo = categorizeError(err);
  res.status(errorInfo.statusCode).json({
    success: false,
    error: errorInfo.message,
    errorType: errorInfo.type,
    ...(errorInfo.exitCode !== undefined && { exitCode: errorInfo.exitCode }),
  });
};

/**
 * Extracts HTTP/HTTPS URLs from an arguments string
 */
export const extractUrls = (argsString: string): string[] => {
  const urlPattern = /https?:\/\/[^\s'"]+/g;
  return argsString.match(urlPattern) ?? [];
};

/**
 * Replaces URLs in an arguments string with local file paths
 */
export const replaceUrlsWithPaths = (
  argsString: string,
  downloadedInputs: Array<{ url: string; localPath: string }>
): string => {
  let modifiedArgs = argsString;
  for (const input of downloadedInputs) {
    modifiedArgs = modifiedArgs.replace(input.url, input.localPath);
  }
  return modifiedArgs;
};
