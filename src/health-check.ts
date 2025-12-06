import type { Request, Response } from "express";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    server: {
      status: "ok";
      uptime: number;
    };
    ffmpeg: {
      status: "ok" | "error";
      version?: string;
      error?: string;
    };
  };
}

/**
 * Verifies FFmpeg binary is installed and working
 * Returns version string if successful, throws error otherwise
 */
const checkFfmpeg = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync("ffmpeg -version", {
      timeout: 5000, // 5 second timeout
    });

    // Extract version from first line (e.g., "ffmpeg version 8.0.1")
    const firstLine = stdout.split("\n")[0];
    const versionMatch = firstLine?.match(/ffmpeg version ([^\s]+)/);
    const version = versionMatch?.[1] ?? "unknown";

    return version;
  } catch (err) {
    const error = err as Error;
    throw new Error(`FFmpeg check failed: ${error.message}`);
  }
};

/**
 * Health check endpoint handler
 * Returns detailed status of server and FFmpeg binary
 */
export const healthCheck = async (
  _req: Request,
  res: Response<HealthCheckResponse>
) => {
  const timestamp = new Date().toISOString();
  const uptime = process.uptime();

  try {
    const ffmpegVersion = await checkFfmpeg();

    res.json({
      status: "healthy",
      timestamp,
      checks: {
        server: {
          status: "ok",
          uptime: Math.floor(uptime),
        },
        ffmpeg: {
          status: "ok",
          version: ffmpegVersion,
        },
      },
    });
  } catch (err) {
    const error = err as Error;

    res.status(503).json({
      status: "unhealthy",
      timestamp,
      checks: {
        server: {
          status: "ok",
          uptime: Math.floor(uptime),
        },
        ffmpeg: {
          status: "error",
          error: error.message,
        },
      },
    });
  }
};
