import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import pLimit from "p-limit";
import { errorMessage, isJobError, jobError } from "./job-error.js";
import { log } from "./log.js";

/**
 * Reads each input's size by asking for its first byte only, so nothing big is downloaded.
 * The size is undefined when the server doesn't report it.
 */
export const sizeInputs = (urls: string[], signal: AbortSignal) =>
  Promise.all(
    urls.map(async (url) => {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(SIZE_TIMEOUT_MS)]),
        });
      } catch (err) {
        if (signal.aborted) throw signal.reason;
        throw jobError("input_failed", `Could not reach input ${withoutQuery(url)}: ${errorMessage(err)}`, {
          retryable: true,
          details: { url: withoutQuery(url) },
        });
      }
      await response.body?.cancel();

      // A range reply says "bytes 0-0/<total size>".
      const rangeTotal = response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
      if (!response.ok && rangeTotal === undefined) {
        throw jobError("input_failed", `Input ${withoutQuery(url)} returned HTTP ${response.status}`, {
          retryable: isRetryableStatus(response.status),
          details: { url: withoutQuery(url), httpStatus: response.status },
        });
      }

      const length = response.status === 200 ? response.headers.get("content-length") : null;
      const size = rangeTotal !== undefined ? Number(rangeTotal) : length ? Number(length) : undefined;
      return { url, size };
    })
  );

/**
 * Downloads each input straight to disk, a few at a time. Network errors and 5xx get up to 3 tries,
 * and a download that receives nothing for 60 s counts as a failed try.
 */
export const downloadInputs = async ({ urls, inDir, jobId, signal, onBytes }: DownloadInputsParams) => {
  const limit = pLimit(DOWNLOADS_AT_ONCE);
  // The first download that fails for good stops the others, so nothing keeps writing after the job cleans up.
  const stopAll = new AbortController();
  const downloadSignal = AbortSignal.any([signal, stopAll.signal]);

  const results = await Promise.allSettled(
    urls.map((url, index) =>
      limit(async () => {
        // A download still waiting in the queue when another one failed doesn't start.
        if (downloadSignal.aborted) throw downloadSignal.reason;
        const name = basename(new URL(url).pathname).replace(/[^\w.-]/g, "_").slice(-100) || "input";
        const path = join(inDir, `${index}-${name}`);

        for (let attempt = 1; ; attempt++) {
          const stall = new AbortController();
          const stallTimer = setTimeout(() => stall.abort(), STALL_MS);
          let received = 0;

          try {
            const response = await fetch(url, { signal: AbortSignal.any([downloadSignal, stall.signal]) });
            if (!response.ok || !response.body) {
              await response.body?.cancel();
              throw jobError("download_failed", `Input ${withoutQuery(url)} returned HTTP ${response.status}`, {
                retryable: isRetryableStatus(response.status),
                details: { url: withoutQuery(url), httpStatus: response.status },
              });
            }

            await pipeline(
              Readable.fromWeb(response.body),
              new Transform({
                transform: (chunk: Buffer, _encoding, callback) => {
                  received += chunk.length;
                  onBytes(chunk.length);
                  stallTimer.refresh();
                  callback(null, chunk);
                },
              }),
              createWriteStream(path)
            );
            return { url, path, size: (await stat(path)).size };
          } catch (err) {
            onBytes(-received);
            if (downloadSignal.aborted) throw downloadSignal.reason;

            const error = isJobError(err)
              ? err
              : jobError(
                  "download_failed",
                  stall.signal.aborted
                    ? `Downloading ${withoutQuery(url)} received no data for ${STALL_MS / 1000} s`
                    : `Downloading ${withoutQuery(url)} failed: ${errorMessage(err)}`,
                  { retryable: true, details: { url: withoutQuery(url) } }
                );
            if (!error.retryable || attempt === DOWNLOAD_TRIES) throw error;

            log("warn", "Input download failed, retrying", {
              jobId,
              url: withoutQuery(url),
              attempt,
              error: error.message,
            });
            await sleep(attempt * 2000, undefined, { signal: downloadSignal });
          } finally {
            clearTimeout(stallTimer);
          }
        }
      }).catch((err: unknown) => {
        stopAll.abort(err);
        throw err;
      })
    )
  );

  // Every download has stopped by now. Report why the job stopped, or else the first failure.
  if (signal.aborted) throw signal.reason;
  if (stopAll.signal.aborted) throw stopAll.signal.reason;
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
};

/**
 * Signed URLs carry their signature in the query string, so logs and responses drop it.
 */
export const withoutQuery = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
};

const isRetryableStatus = (status: number) => status >= 500 || status === 408 || status === 429;

type DownloadInputsParams = {
  urls: string[];
  inDir: string;
  jobId: string;
  signal: AbortSignal;
  onBytes: (bytes: number) => void;
};

const SIZE_TIMEOUT_MS = 15_000;
const DOWNLOADS_AT_ONCE = 4;
const DOWNLOAD_TRIES = 3;
const STALL_MS = 60_000;
