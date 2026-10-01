import { execFileSync, spawn } from "node:child_process";
import { chown } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parse } from "shell-quote";
import { jobError } from "./job-error.js";

/**
 * Splits a terminal-style command into FFmpeg arguments. No shell runs, so shell syntax outside quotes
 * is rejected; passing it through would only reach FFmpeg as odd file names.
 */
export const parseCommand = (command: string): string[] => {
  // `$NAME` stays as written: nothing expands variables.
  const entries = parse(command.slice("ffmpeg ".length), (name) => `$${name}`);
  const args: string[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      args.push(entry);
    } else if ("comment" in entry) {
      throw jobError("invalid_request", "An unquoted # starts a shell comment. Put that argument in quotes.", {
        retryable: false,
      });
    } else if (entry.op === "glob") {
      // No shell means no globbing: FFmpeg gets the pattern as written (e.g. for -pattern_type glob).
      args.push(entry.pattern);
    } else {
      throw jobError(
        "invalid_request",
        `Unquoted "${entry.op}" is not allowed because no shell runs here. If it belongs to an argument, like a filter graph, put that argument in quotes.`,
        { retryable: false }
      );
    }
  }

  if (args.length === 0) {
    throw jobError("invalid_request", "The command has no arguments after 'ffmpeg'", { retryable: false });
  }
  return args;
};

/**
 * Runs FFmpeg inside `outDir` and always resolves with how it ended, so the caller can report the log on failure.
 * Rejects only when FFmpeg can't be started at all.
 */
export const runFfmpeg = async ({ args, outDir, timeoutMinutes, signal, onProgress }: RunFfmpegParams) => {
  if (FFMPEG_UID !== undefined && FFMPEG_GID !== undefined) {
    await chown(outDir, FFMPEG_UID, FFMPEG_GID);
  }

  const child = spawn("ffmpeg", args, {
    cwd: outDir,
    // Only what FFmpeg needs: none of the server's secrets. HOME gives fontconfig a cache folder outside outDir.
    env: { PATH: process.env.PATH, HOME: tmpdir() },
    stdio: ["ignore", "pipe", "pipe"],
    uid: FFMPEG_UID,
    gid: FFMPEG_GID,
  });

  // The log is kept as a terminal shows it: a line ended by a bare \r (FFmpeg's progress line) gets redrawn.
  // Past LOG_MAX_CHARS, lines after the first LOG_HEAD_CHARS are dropped from the middle.
  const lines: string[] = [];
  let logChars = 0;
  let headLines = 0;
  let cutLines = 0;
  let partialLine = "";
  let redrawLastLine = false;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    const pieces = text.split(/(\r\n|\r|\n)/);
    for (let index = 0; index < pieces.length; index += 2) {
      partialLine += pieces[index] ?? "";
      const separator = pieces[index + 1];
      if (separator === undefined) continue;

      if (redrawLastLine && lines.length > 0) {
        logChars -= (lines.at(-1) ?? "").length;
        lines[lines.length - 1] = partialLine;
      } else {
        lines.push(partialLine);
      }
      logChars += partialLine.length;
      if (headLines === 0 && logChars >= LOG_HEAD_CHARS) headLines = lines.length;
      while (logChars > LOG_MAX_CHARS && headLines > 0 && lines.length > headLines + 1) {
        logChars -= lines.splice(headLines, 1)[0]?.length ?? 0;
        cutLines += 1;
      }

      const time = partialLine.match(/time=(\d+:\d\d:\d\d)/)?.[1];
      const speed = partialLine.match(/speed=\s*([\d.]+x)/)?.[1];
      if (time) onProgress({ ffmpegTime: time, ...(speed && { speed }) });

      redrawLastLine = separator === "\r";
      partialLine = "";
    }
  });

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    if (stdout.length < STDOUT_MAX_CHARS) stdout += text.slice(0, STDOUT_MAX_CHARS - stdout.length);
  });

  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMinutes * 60_000);
  const kill = () => child.kill("SIGKILL");
  signal.addEventListener("abort", kill, { once: true });

  try {
    const { exitCode, killedBy } = await new Promise<{ exitCode: number | null; killedBy: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signalName) => resolve({ exitCode: code, killedBy: signalName }));
      }
    );

    if (partialLine) lines.push(partialLine);
    const log =
      cutLines > 0
        ? [...lines.slice(0, headLines), `… ${cutLines} log lines cut …`, ...lines.slice(headLines)].join("\n")
        : lines.join("\n");
    return { exitCode, killedBy, timedOut, log, stdout };
  } finally {
    clearTimeout(timeoutTimer);
    signal.removeEventListener("abort", kill);
  }
};

type RunFfmpegParams = {
  args: string[];
  outDir: string;
  timeoutMinutes: number;
  signal: AbortSignal;
  onProgress: (progress: { ffmpegTime: string; speed?: string }) => void;
};

const LOG_MAX_CHARS = 1_000_000;
const LOG_HEAD_CHARS = 250_000;
const STDOUT_MAX_CHARS = 1_000_000;

// In Docker the server runs as root. FFmpeg then runs as the unprivileged "ffmpeg" user from the Dockerfile,
// so a command can't read the server's environment, memory, or files.
const RUNNING_AS_ROOT = process.getuid?.() === 0;
const FFMPEG_UID = RUNNING_AS_ROOT ? Number(execFileSync("id", ["-u", "ffmpeg"], { encoding: "utf8" })) : undefined;
const FFMPEG_GID = RUNNING_AS_ROOT ? Number(execFileSync("id", ["-g", "ffmpeg"], { encoding: "utf8" })) : undefined;
