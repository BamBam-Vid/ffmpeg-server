import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  AbortMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { lookup } from "mime-types";
import { errorMessage, jobError } from "./job-error.js";
import { log } from "./log.js";

/**
 * S3 client for the caller's bucket. Works with any S3-compatible storage (R2, AWS S3, ...).
 */
export const createStorageClient = (storage: StorageSettings) =>
  new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    credentials: { accessKeyId: storage.accessKeyId, secretAccessKey: storage.secretAccessKey },
    // A failed request (e.g. one upload part) is retried up to 3 times.
    maxAttempts: 4,
    // Newer AWS SDKs add optional checksums that some S3-compatible stores reject; send them only when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

/**
 * Proves the endpoint, bucket, keys, and write access work by starting an upload and aborting it right away.
 * Nothing is left in the bucket.
 */
export const checkStorage = async ({ client, bucket, prefix, jobId, signal }: CheckStorageParams) => {
  const key = `${prefix}.stream-ffmpeg-check`;
  const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(CHECK_TIMEOUT_MS)]);

  let uploadId: string | undefined;
  try {
    ({ UploadId: uploadId } = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
      { abortSignal }
    ));
  } catch (err) {
    if (signal.aborted) throw signal.reason;
    if (isRefusal(err)) {
      throw jobError("storage_rejected", `Storage refused the request (${err.name})`, {
        retryable: false,
        details: { storageCode: err.name, httpStatus: err.$metadata.httpStatusCode },
      });
    }
    throw jobError("storage_unreachable", `Could not reach storage: ${errorMessage(err)}`, {
      retryable: true,
    });
  }

  await client
    .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }), { abortSignal })
    .catch((err: unknown) =>
      // Harmless: R2 removes unfinished uploads on its own after 7 days.
      log("warn", "Could not abort the storage check upload", { jobId, error: errorMessage(err) })
    );
};

/**
 * Uploads every file FFmpeg wrote, one at a time, in 16 MB parts with 4 parts in flight.
 * Each uploaded file is added to `outputs` right away, so a failure can list what was already uploaded.
 */
export const uploadOutputs = async ({
  client,
  bucket,
  prefix,
  outDir,
  signal,
  outputs,
  onProgress,
}: UploadOutputsParams) => {
  const entries = await readdir(outDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({ name: entry.name, size: (await stat(join(outDir, entry.name))).size }))
  );
  const bytesTotal = files.reduce((sum, file) => sum + file.size, 0);
  let bytesBefore = 0;

  for (const file of files) {
    const key = `${prefix}${file.name}`;
    const contentType = lookup(file.name) || "application/octet-stream";
    const upload = new Upload({
      client,
      params: { Bucket: bucket, Key: key, Body: createReadStream(join(outDir, file.name)), ContentType: contentType },
      partSize: PART_BYTES,
      queueSize: PARTS_AT_ONCE,
      leavePartsOnError: false,
    });

    let stalled = false;
    const stallTimer = setTimeout(() => {
      stalled = true;
      void upload.abort();
    }, STALL_MS);
    const abortUpload = () => void upload.abort();
    signal.addEventListener("abort", abortUpload, { once: true });
    upload.on("httpUploadProgress", (progress) => {
      stallTimer.refresh();
      onProgress({ bytesDone: bytesBefore + (progress.loaded ?? 0), bytesTotal });
    });

    try {
      await upload.done();
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      if (stalled) {
        throw jobError("upload_failed", `Uploading ${key} made no progress for ${STALL_MS / 1000} s`, {
          retryable: true,
          details: { key },
        });
      }
      throw jobError("upload_failed", `Uploading ${key} failed: ${errorMessage(err)}`, {
        retryable: !isRefusal(err),
        details: {
          key,
          ...(err instanceof S3ServiceException && {
            storageCode: err.name,
            httpStatus: err.$metadata.httpStatusCode,
          }),
        },
      });
    } finally {
      clearTimeout(stallTimer);
      signal.removeEventListener("abort", abortUpload);
    }

    outputs.push({ key, size: file.size, contentType });
    bytesBefore += file.size;
  }
};

/**
 * True when the storage answered with a 4xx that a retry won't fix, such as AccessDenied or NoSuchBucket.
 */
const isRefusal = (err: unknown): err is S3ServiceException => {
  if (!(err instanceof S3ServiceException)) return false;
  const status = err.$metadata.httpStatusCode ?? 500;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
};

export type OutputFile = { key: string; size: number; contentType: string };

type StorageSettings = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type CheckStorageParams = {
  client: S3Client;
  bucket: string;
  prefix: string;
  jobId: string;
  signal: AbortSignal;
};

type UploadOutputsParams = {
  client: S3Client;
  bucket: string;
  prefix: string;
  outDir: string;
  signal: AbortSignal;
  outputs: OutputFile[];
  onProgress: (progress: { bytesDone: number; bytesTotal: number }) => void;
};

const CHECK_TIMEOUT_MS = 15_000;
const PART_BYTES = 16 * 1024 * 1024;
const PARTS_AT_ONCE = 4;
const STALL_MS = 60_000;
