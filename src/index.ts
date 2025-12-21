import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { executeFfmpeg } from "./execute-ffmpeg.js";
import { healthCheck } from "./health-check.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 5675;

app.use(cors());
app.use(express.json());
app.use(requestIdMiddleware);

app.get("/health", healthCheck);

app.post("/execute-ffmpeg", executeFfmpeg);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running http://localhost:${PORT}`);
});
