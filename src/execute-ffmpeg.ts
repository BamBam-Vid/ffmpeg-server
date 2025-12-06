import type { Request, Response } from "express";

interface ExecuteFfmpegRequest {
  command: string;
}

interface ExecuteFfmpegResponse {
  result: string;
}

export const executeFfmpeg = (
  req: Request,
  res: Response<ExecuteFfmpegResponse>
) => {
  const { command } = req.body as ExecuteFfmpegRequest;

  // Dummy implementation - just return the command as result
  res.json({ result: command });
};
