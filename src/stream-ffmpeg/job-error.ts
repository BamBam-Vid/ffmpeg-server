/**
 * Creates an error that /stream-ffmpeg can send to the caller as-is.
 * The status code is used only before the stream starts. By default it is 503 when retryable, otherwise 400.
 */
export const jobError = (
  reason: JobErrorReason,
  message: string,
  options: { retryable: boolean; status?: number; details?: Record<string, unknown> }
): JobError =>
  Object.assign(new Error(message), {
    reason,
    retryable: options.retryable,
    status: options.status ?? (options.retryable ? 503 : 400),
    details: options.details ?? {},
  });

export const isJobError = (err: unknown): err is JobError =>
  err instanceof Error && "reason" in err && "retryable" in err;

/**
 * Error message with its cause, e.g. "fetch failed: getaddrinfo ENOTFOUND cdn.example.com".
 */
export const errorMessage = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
};

export type JobError = Error & {
  reason: JobErrorReason;
  retryable: boolean;
  status: number;
  details: Record<string, unknown>;
};

export type JobErrorReason =
  | "invalid_request"
  | "too_big"
  | "busy"
  | "input_failed"
  | "storage_rejected"
  | "storage_unreachable"
  | "download_failed"
  | "ffmpeg_failed"
  | "timeout"
  | "upload_failed"
  | "server_restarting"
  | "internal_error";
