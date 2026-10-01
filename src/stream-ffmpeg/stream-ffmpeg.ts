import type { NextFunction, Request, Response } from "express";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quote } from "shell-quote";
import { z } from "zod";
import {
  getCapacity,
  releaseDisk,
  releaseJobSlot,
  reserveDisk,
  reserveExtraDisk,
  takeJobSlot,
} from "./capacity.js";
import { parseCommand, runFfmpeg } from "./ffmpeg.js";
import { downloadInputs, sizeInputs, withoutQuery } from "./inputs.js";
import { errorMessage, isJobError, jobError, type JobError } from "./job-error.js";
import { log } from "./log.js";
import { checkStorage, createStorageClient, uploadOutputs, type OutputFile } from "./storage.js";

/**
 * POST /stream-ffmpeg: runs one FFmpeg command and streams progress as JSON lines.
 * Quick checks fail with a plain JSON error. After them the reply is 200 and ends with one `result` or `error` line.
 * The caller contract is docs/stream-ffmpeg-api.md.
 */
export const streamFfmpeg = async (req: Request, res: Response) => {
  if (shuttingDown) {
    return sendError(res, jobError("server_restarting", "The server is restarting", { retryable: true }));
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));
    return sendError(
      res,
      jobError("invalid_request", "The request body is invalid", { retryable: false, details: { issues } })
    );
  }
  const { command, storage, timeoutMinutes } = parsed.data;
  const prefix = storage.prefix === "" || storage.prefix.endsWith("/") ? storage.prefix : `${storage.prefix}/`;

  let args: string[];
  try {
    args = parseCommand(command);
  } catch (err) {
    if (!isJobError(err)) throw err;
    return sendError(res, err);
  }
  const inputUrls = [...new Set(args.filter((arg) => /^https?:\/\/\S+$/i.test(arg) && URL.canParse(arg)))];

  if (!takeJobSlot()) {
    const { jobsRunning, maxJobs } = getCapacity();
    log("info", "Busy: no free job slot", { jobsRunning, maxJobs });
    return sendError(
      res,
      jobError("busy", `All ${maxJobs} job slots are in use`, {
        retryable: true,
        details: { slotsUsed: jobsRunning, slotsMax: maxJobs },
      })
    );
  }

  const jobId = randomUUID();
  const jobDir = join(JOBS_ROOT, jobId);
  const controller = new AbortController();
  const callerGone = new Error("The caller disconnected");
  let markFinished = () => {};
  runningJobs.set(jobId, { controller, finished: new Promise<void>((resolve) => (markFinished = resolve)) });
  res.on("close", () => {
    if (!res.writableFinished) controller.abort(callerGone);
  });

  const report: JobReport = { inputs: [], timings: {}, outputs: [] };
  const startedAt = performance.now();
  let reservedBytes = 0;
  let storageClient: ReturnType<typeof createStorageClient> | undefined;
  let progressTimer: NodeJS.Timeout | undefined;
  let step: Step | undefined;
  let stepStartedAt = 0;
  let stepProgress: Record<string, unknown> = {};

  const writeLine = (line: Record<string, unknown>) => {
    if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(line)}\n`);
  };
  const writeProgress = () =>
    writeLine({ type: "progress", step, elapsedSeconds: secondsSince(startedAt), ...stepProgress });
  const setStep = (next: Step | undefined) => {
    if (step) report.timings[`${step}Seconds`] = secondsSince(stepStartedAt);
    step = next;
    stepStartedAt = performance.now();
    stepProgress = {};
    if (next) writeProgress();
  };

  try {
    const sized = await sizeInputs(inputUrls, controller.signal);
    const knownInputBytes = sized.reduce((sum, input) => sum + (input.size ?? 0), 0);
    const estimateBytes = Math.ceil(
      DISK_PER_INPUT_BYTE * sized.reduce((sum, input) => sum + (input.size ?? UNKNOWN_INPUT_BYTES), 0)
    );

    const disk = await reserveDisk(estimateBytes, JOBS_ROOT);
    if (!disk.fits) {
      throw jobError(disk.neverFits ? "too_big" : "busy", disk.message, {
        retryable: !disk.neverFits,
        details: disk.details,
      });
    }
    reservedBytes = estimateBytes;

    storageClient = createStorageClient(storage);
    await checkStorage({ client: storageClient, bucket: storage.bucket, prefix, jobId, signal: controller.signal });

    log("info", "Job accepted", {
      jobId,
      inputCount: inputUrls.length,
      inputBytes: knownInputBytes,
      diskEstimateBytes: estimateBytes,
    });
    res.status(200).setHeader("Content-Type", "application/x-ndjson");
    writeLine({ type: "started", jobId });
    progressTimer = setInterval(writeProgress, PROGRESS_INTERVAL_MS);

    const inDir = join(jobDir, "in");
    const outDir = join(jobDir, "out");
    await mkdir(inDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    setStep("download");
    let bytesDone = 0;
    const downloaded = await downloadInputs({
      urls: inputUrls,
      inDir,
      jobId,
      signal: controller.signal,
      onBytes: (bytes) => {
        bytesDone += bytes;
        stepProgress = { bytesDone, bytesTotal: knownInputBytes };
      },
    });
    report.inputs = downloaded.map(({ url, size }) => ({ url: withoutQuery(url), size }));
    const actualEstimateBytes = Math.ceil(
      DISK_PER_INPUT_BYTE * downloaded.reduce((sum, input) => sum + input.size, 0)
    );
    if (actualEstimateBytes > reservedBytes) {
      reserveExtraDisk(actualEstimateBytes - reservedBytes);
      reservedBytes = actualEstimateBytes;
    }

    const localPaths = new Map(downloaded.map(({ url, path }) => [url, path]));
    const localArgs = args.map((arg) => localPaths.get(arg) ?? arg);
    report.ffmpegCommand = quote(["ffmpeg", ...localArgs]);

    setStep("ffmpeg");
    const ffmpeg = await runFfmpeg({
      args: localArgs,
      outDir,
      timeoutMinutes,
      signal: controller.signal,
      onProgress: (progress) => {
        stepProgress = progress;
      },
    });
    report.exitCode = ffmpeg.exitCode;
    report.log = ffmpeg.log;
    report.stdout = ffmpeg.stdout;
    if (controller.signal.aborted) throw controller.signal.reason;
    if (ffmpeg.timedOut) {
      throw jobError("timeout", `FFmpeg ran longer than ${timeoutMinutes} minutes`, { retryable: false });
    }
    if (ffmpeg.killedBy) {
      throw jobError(
        "ffmpeg_failed",
        `FFmpeg was killed by ${ffmpeg.killedBy}, often because the server ran out of memory`,
        { retryable: true, details: { signal: ffmpeg.killedBy } }
      );
    }
    if (ffmpeg.exitCode !== 0) {
      throw jobError("ffmpeg_failed", `FFmpeg exited with code ${ffmpeg.exitCode}`, {
        retryable: false,
        details: { exitCode: ffmpeg.exitCode },
      });
    }

    setStep("upload");
    await uploadOutputs({
      client: storageClient,
      bucket: storage.bucket,
      prefix,
      outDir,
      signal: controller.signal,
      outputs: report.outputs,
      onProgress: (progress) => {
        stepProgress = progress;
      },
    });
    setStep(undefined);

    writeLine({ type: "result", jobId, ...report });
    res.end();
    log("info", "Job finished", {
      jobId,
      outputs: report.outputs.map(({ key, size }) => ({ key, size })),
      timings: report.timings,
    });
  } catch (err) {
    const failedStep = step;
    setStep(undefined);
    const error: unknown = controller.signal.aborted ? controller.signal.reason : err;

    if (error === callerGone) {
      log("info", "Caller disconnected, job stopped", { jobId, step: failedStep });
      return;
    }
    // An unexpected failure before the stream starts goes to the global error handler, which answers 500.
    if (!isJobError(error) && !res.headersSent) throw error;

    const failure = isJobError(error)
      ? error
      : jobError("internal_error", errorMessage(error), { retryable: true, status: 500 });
    log(failure.reason === "internal_error" ? "error" : failure.reason === "busy" ? "info" : "warn", "Job failed", {
      jobId,
      step: failedStep,
      reason: failure.reason,
      error: failure.message,
      details: failure.details,
      ...(failure.reason === "internal_error" && error instanceof Error && { stack: error.stack }),
      ...(failure.reason === "ffmpeg_failed" && { logTail: report.log?.split("\n").slice(-100).join("\n") }),
    });

    if (!res.headersSent) return sendError(res, failure);
    const { outputs, ...known } = report;
    writeLine({
      type: "error",
      jobId,
      reason: failure.reason,
      message: failure.message,
      retryable: failure.retryable,
      details: failure.details,
      ...known,
      ...(failure.reason === "upload_failed" && { uploaded: outputs.map((output) => output.key) }),
    });
    res.end();
  } finally {
    clearInterval(progressTimer);
    storageClient?.destroy();
    // A failed delete must not stop the slot and disk space from being freed below.
    await rm(jobDir, { recursive: true, force: true }).catch((err: unknown) =>
      log("warn", "Could not delete the job folder", { jobId, error: errorMessage(err) })
    );
    releaseDisk(reservedBytes);
    releaseJobSlot();
    runningJobs.delete(jobId);
    markFinished();
  }
};

/**
 * Answers errors that reach Express from /stream-ffmpeg (bad JSON bodies, unexpected bugs) in the endpoint's error shape.
 * Errors from other routes keep Express's default handling.
 */
export const streamFfmpegErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (req.path !== "/stream-ffmpeg" || res.headersSent) return next(err);

  // express.json() marks body problems with an `entity.*` type, e.g. "entity.parse.failed".
  if (err instanceof Error && "type" in err && String(err.type).startsWith("entity.")) {
    return sendError(res, jobError("invalid_request", "The request body is not valid JSON", { retryable: false }));
  }

  log("error", "Unexpected error in /stream-ffmpeg", {
    error: errorMessage(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  sendError(res, jobError("internal_error", "Something went wrong on the server", { retryable: true, status: 500 }));
};

/**
 * Startup: clears job folders left by a restart and checks FFmpeg runs. Throws if it doesn't.
 */
export const startStreamFfmpeg = async () => {
  await rm(JOBS_ROOT, { recursive: true, force: true });
  await mkdir(JOBS_ROOT, { recursive: true });
  const versionOutput = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" });
  log("info", "stream-ffmpeg ready", {
    ffmpegVersion: versionOutput.match(/ffmpeg version (\S+)/)?.[1] ?? "unknown",
    ...getCapacity(),
  });
};

/**
 * Shutdown: new requests get 503, and running jobs end with a retryable `server_restarting` error.
 */
export const stopAllJobs = async () => {
  shuttingDown = true;
  const jobs = [...runningJobs.values()];
  log("info", "Stopping running jobs", { count: jobs.length });
  for (const job of jobs) {
    job.controller.abort(jobError("server_restarting", "The server is restarting", { retryable: true }));
  }
  await Promise.all(jobs.map((job) => job.finished));
};

const requestSchema = z.object({
  command: z.string().trim().startsWith("ffmpeg ", "The command must start with 'ffmpeg '"),
  storage: z.object({
    endpoint: z.url(),
    bucket: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    region: z.string().min(1).default("auto"),
    prefix: z.string().default(""),
  }),
  timeoutMinutes: z.number().min(1).default(60),
});

const sendError = (res: Response, error: JobError) => {
  if (error.status === 503) res.setHeader("Retry-After", String(RETRY_AFTER_SECONDS));
  res.status(error.status).json({
    type: "error",
    reason: error.reason,
    message: error.message,
    retryable: error.retryable,
    details: error.details,
  });
};

const secondsSince = (start: number) => Math.round((performance.now() - start) / 100) / 10;

type Step = "download" | "ffmpeg" | "upload";

type JobReport = {
  inputs: Array<{ url: string; size: number }>;
  ffmpegCommand?: string;
  exitCode?: number | null;
  timings: Partial<Record<`${Step}Seconds`, number>>;
  log?: string;
  stdout?: string;
  outputs: OutputFile[];
};

const JOBS_ROOT = join(tmpdir(), "stream-ffmpeg");
// A job sets aside its inputs plus 2.5x their size for outputs.
const DISK_PER_INPUT_BYTE = 3.5;
// Inputs whose server doesn't report a size count as 1 GB.
const UNKNOWN_INPUT_BYTES = 1024 ** 3;
const PROGRESS_INTERVAL_MS = 10_000;
const RETRY_AFTER_SECONDS = 30;

const runningJobs = new Map<string, { controller: AbortController; finished: Promise<void> }>();
let shuttingDown = false;
