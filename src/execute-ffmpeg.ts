import type { Request, Response } from "express";
import { z } from "zod";

const executeFfmpegSchema = z.object({
  command: z.string().min(1),
});

interface ExecuteFfmpegResponse {
  result: string;
}

export const executeFfmpeg = (
  req: Request,
  res: Response<ExecuteFfmpegResponse>
) => {
  const parseResult = executeFfmpegSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({ result: parseResult.error.message });
  }

  const { command } = parseResult.data;

  // Dummy implementation - just return the command as result
  res.json({ result: command });
};
