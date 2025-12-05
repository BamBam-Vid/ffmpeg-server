import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 5675;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.json({ message: "FFmpeg Server is running" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running http://localhost:${PORT}`);
});
