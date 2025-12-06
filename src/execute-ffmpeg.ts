import type { Request, Response } from "express";
import { z } from "zod";

const executeFfmpegSchema = z.object({
  command: z.string().min(1),
});

interface ExecuteFfmpegResponse {
  result: string;
}

interface ErrorResponse {
  error: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}

export const executeFfmpeg = (
  req: Request,
  res: Response<ExecuteFfmpegResponse | ErrorResponse>
) => {
  const parseResult = executeFfmpegSchema.safeParse(req.body);

  if (!parseResult.success) {
    const details = parseResult.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));

    return res.status(400).json({
      error: "Validation failed",
      details,
    });
  }

  const { command } = parseResult.data;

  // Dummy implementation - just return the command as result
  res.json({ result: command });
};
