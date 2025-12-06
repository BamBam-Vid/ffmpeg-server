import type { Request, Response } from "express";
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import PQueue from "p-queue";
import { parse as shellParse } from "shell-quote";
import { z } from "zod";
import {
  parseOutputFiles,
  createTempDir,
  resolveOutputPaths,
  replaceOutputPaths,
  uploadToSupabase,
  cleanupTempFiles,
} from "./lib/ffmpeg-utils.js";
import type { OutputFile } from "./lib/ffmpeg-utils.js";

const executeFfmpegSchema = z.object({
  args: z.string().min(1),
});

// Calculate max concurrent FFmpeg processes based on CPU count
// Use half of available CPUs, minimum 2, maximum 8
const cpuCount = cpus().length;
// eslint-disable-next-line no-console
console.log("[cpuCount]: ", cpuCount);

const maxConcurrent = Math.min(Math.max(Math.floor(cpuCount / 2), 2), 8);
// eslint-disable-next-line no-console
console.log("[maxConcurrent]: ", maxConcurrent);

// Create queue for managing concurrent FFmpeg processes
const ffmpegQueue = new PQueue({ concurrency: maxConcurrent });

interface ExecuteFfmpegResponse {
  success: true;
  stdout: string;
  stderr: string;
  exitCode: number;
  outputs: OutputFile[];
}

interface ErrorResponse {
  success: false;
  error: string;
  errorType: "validation" | "timeout" | "spawn" | "execution" | "parse" | "storage";
  details?: Array<{
    field: string;
    message: string;
  }>;
  exitCode?: number;
}

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

  const { args } = parseResult.data;

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

/**
 * Executes FFmpeg command using child_process.spawn
 * Returns promise that resolves with stdout/stderr/exitCode/outputs
 */
const runFFmpeg = async (
  argsString: string,
  timeoutMs: number = 5 * 60 * 1000 // Default: 5 minutes
): Promise<ExecuteFfmpegResponse> => {
  const args = parseArgs(argsString);

  // Parse output files from args
  const outputFiles = parseOutputFiles(args);

  // Create temp directory for outputs
  const tempDir = await createTempDir();

  // Map output files to absolute paths in temp directory
  const pathMap = resolveOutputPaths(outputFiles, tempDir);

  // Replace output paths in args with temp directory paths
  const modifiedArgs = replaceOutputPaths(args, pathMap);

  // Get all temp file paths for cleanup
  const tempFilePaths = Array.from(pathMap.values());

  try {
    // Execute FFmpeg with modified args
    const { stdout, stderr, exitCode } = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve, reject) => {
      const ffmpegProcess = spawn("ffmpeg", modifiedArgs);

      let stdout = "";
      let stderr = "";
      let isTimedOut = false;

      // Set timeout to kill process if it runs too long
      const timeoutId = setTimeout(() => {
        isTimedOut = true;
        ffmpegProcess.kill("SIGKILL");
        reject(
          new Error(`FFmpeg process timed out after ${timeoutMs / 1000} seconds`)
        );
      }, timeoutMs);

      // Capture stdout
      ffmpegProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      // Capture stderr (FFmpeg outputs progress info to stderr)
      ffmpegProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process completion
      ffmpegProcess.on("close", code => {
        clearTimeout(timeoutId);

        // Don't resolve if we already timed out
        if (isTimedOut) {
          return;
        }

        const exitCode = code ?? -1;

        if (exitCode === 0) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(
            new Error(`FFmpeg process exited with code ${exitCode}\n${stderr}`)
          );
        }
      });

      // Handle spawn errors (e.g., FFmpeg not found)
      ffmpegProcess.on("error", err => {
        clearTimeout(timeoutId);

        if (!isTimedOut) {
          reject(new Error(`Failed to spawn FFmpeg process: ${err.message}`));
        }
      });
    });

    // Upload all output files to Supabase Storage
    const uploadedOutputs: OutputFile[] = [];

    for (const [originalPath, tempPath] of pathMap.entries()) {
      try {
        const uploadedFile = await uploadToSupabase(tempPath, originalPath);
        uploadedOutputs.push(uploadedFile);
      } catch (uploadErr) {
        // Clean up temp files before throwing
        await cleanupTempFiles(tempFilePaths);
        throw uploadErr;
      }
    }

    // Clean up temp files after successful upload
    await cleanupTempFiles(tempFilePaths);

    return {
      success: true,
      stdout,
      stderr,
      exitCode,
      outputs: uploadedOutputs,
    };
  } catch (err) {
    // Clean up temp files on any error
    await cleanupTempFiles(tempFilePaths);
    throw err;
  }
};

/**
 * Categorizes errors and determines appropriate HTTP status code
 */
const categorizeError = (
  err: unknown
): {
  type: "timeout" | "spawn" | "execution" | "parse" | "storage";
  message: string;
  statusCode: number;
  exitCode?: number;
} => {
  if (!(err instanceof Error)) {
    return {
      type: "execution",
      message: "Unknown error occurred",
      statusCode: 500,
    };
  }

  const errorMessage = err.message;

  // Storage error (Supabase upload failures)
  if (
    errorMessage.includes("Supabase") ||
    errorMessage.includes("upload") ||
    errorMessage.includes("SUPABASE_BUCKET") ||
    errorMessage.includes("exceeds maximum size")
  ) {
    return {
      type: "storage",
      message: errorMessage,
      statusCode: 500,
    };
  }

  // Timeout error
  if (errorMessage.includes("timed out")) {
    return {
      type: "timeout",
      message: errorMessage,
      statusCode: 408, // Request Timeout
    };
  }

  // Spawn error (FFmpeg not found)
  if (errorMessage.includes("Failed to spawn")) {
    return {
      type: "spawn",
      message: errorMessage,
      statusCode: 500,
    };
  }

  // Parse error (empty arguments or shell operators)
  if (
    errorMessage.includes("Arguments are empty") ||
    errorMessage.includes("Shell operators")
  ) {
    return {
      type: "parse",
      message: errorMessage,
      statusCode: 400,
    };
  }

  // Execution error (non-zero exit code)
  if (errorMessage.includes("exited with code")) {
    const exitCodeMatch = errorMessage.match(/exited with code (\d+)/);
    const exitCode = exitCodeMatch?.[1]
      ? parseInt(exitCodeMatch[1], 10)
      : undefined;

    return {
      type: "execution",
      message: errorMessage,
      statusCode: 400, // Bad Request - invalid FFmpeg arguments
      exitCode,
    };
  }

  // Default error
  return {
    type: "execution",
    message: errorMessage,
    statusCode: 500,
  };
};

/**
 * Parses arguments string into array using shell-quote library
 * Handles quotes, escapes, and special characters like a POSIX shell
 */
const parseArgs = (argsString: string): string[] => {
  const trimmed = argsString.trim();

  if (!trimmed) {
    throw new Error("Arguments are empty");
  }

  const parsed = shellParse(trimmed);

  // Filter out only string arguments (ignore shell operators like >, |, etc)
  const args: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      args.push(entry);
    } else if (typeof entry === "object" && "op" in entry) {
      // Shell operators like >, |, &&, || are not allowed in FFmpeg args
      throw new Error(`Shell operators (${entry.op}) are not allowed in FFmpeg arguments`);
    }
  }

  if (args.length === 0) {
    throw new Error("Arguments are empty");
  }

  return args;
};
