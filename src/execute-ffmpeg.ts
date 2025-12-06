import type { Request, Response } from "express";
import { spawn } from "node:child_process";
import { z } from "zod";

const executeFfmpegSchema = z.object({
  command: z.string().min(1),
});

interface ExecuteFfmpegResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ErrorResponse {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
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
      error: "Validation failed",
      details,
    });
  }

  const { command } = parseResult.data;

  try {
    const result = await runFFmpeg(command);
    res.json(result);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error occurred";
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Executes FFmpeg command using child_process.spawn
 * Returns promise that resolves with stdout/stderr/exitCode
 */
const runFFmpeg = (command: string): Promise<ExecuteFfmpegResponse> => {
  return new Promise((resolve, reject) => {
    const { executable, args } = parseCommand(command);

    const ffmpegProcess = spawn(executable, args);

    let stdout = "";
    let stderr = "";

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
      reject(new Error(`Failed to spawn FFmpeg process: ${err.message}`));
    });
  });
};

/**
 * Parses a command string into executable and arguments array
 * Simple split by spaces - doesn't handle quoted arguments yet
 */
const parseCommand = (
  command: string
): { executable: string; args: string[] } => {
  const parts = command.trim().split(/\s+/);
  const executable = parts[0];
  const args = parts.slice(1);

  if (!executable) {
    throw new Error("Command is empty");
  }

  return { executable, args };
};
