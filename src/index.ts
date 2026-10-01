// Loads .env before any other module reads process.env.
import "dotenv/config";
import express from "express";
import cors from "cors";
import { executeFfmpeg } from "./execute-ffmpeg.js";
import { executeFfprobe } from "./execute-ffprobe.js";
import { healthCheck } from "./health-check.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import {
  startStreamFfmpeg,
  stopAllJobs,
  streamFfmpeg,
  streamFfmpegErrorHandler,
} from "./stream-ffmpeg/stream-ffmpeg.js";

const app = express();
const PORT = process.env.PORT ?? 5675;

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

app.get("/health", healthCheck);

app.post("/execute-ffmpeg", executeFfmpeg);
app.post("/execute-ffprobe", executeFfprobe);
app.post("/stream-ffmpeg", streamFfmpeg);

app.use(streamFfmpegErrorHandler);

await startStreamFfmpeg();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running http://localhost:${PORT}`);
});

// Railway sends SIGTERM before a deploy replaces this server.
const shutDown = async () => {
  await stopAllJobs();
  // Give the final error lines a moment to reach callers.
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);
