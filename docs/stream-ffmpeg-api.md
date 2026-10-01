# `POST /stream-ffmpeg` API guide

This endpoint runs one FFmpeg command. It downloads the inputs from URLs and uploads every output file to your S3-compatible bucket (for example Cloudflare R2). It streams progress while it works, then ends with one final line: a result or an error.

This guide is the contract for callers. Follow it exactly.

## How a call goes

1. Send `POST /stream-ffmpeg` with a JSON body (see [Request](#request)).
2. The server first runs some quick checks: the request, free capacity, input sizes, and storage access. If any check fails, you get a plain JSON error with status `400`, `503`, or `500`, and no stream.
3. If every check passes, you get status `200` and a stream of JSON lines. Read lines until one has `type` `result` or `error`.
4. Retry when the error says `retryable: true`, or when the stream ends without a final line. Retries are safe because the same output keys get overwritten.
5. To cancel a job, close the connection. The server then stops FFmpeg and cleans up.

## Endpoint

- `POST http://<host>:5675/stream-ffmpeg` with the header `Content-Type: application/json`.
- On Railway, call it over the private network: `http://<service>.railway.internal:5675`. Don't use the public URL, because Railway cuts public requests off at 15 minutes.
- There is no auth. The server must only be reachable on the private network.

## Request

```json
{
  "command": "ffmpeg -i https://cdn.example.com/bg.mp4 -i https://cdn.example.com/music.mp3 -filter_complex \"[0:v]scale=1280:720[v]\" -map \"[v]\" -map 1:a -c:v libx264 -shortest room-15.mp4",
  "storage": {
    "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
    "region": "auto",
    "bucket": "videos",
    "accessKeyId": "<key id>",
    "secretAccessKey": "<secret>",
    "prefix": "glitch/room-15/"
  },
  "timeoutMinutes": 60
}
```

| Field | Type | Required | Default | Rules |
| --- | --- | --- | --- | --- |
| `command` | string | yes | — | Must start with `ffmpeg `. See [Command rules](#command-rules). |
| `storage.endpoint` | string | yes | — | S3 endpoint URL. For R2: `https://<account-id>.r2.cloudflarestorage.com`. |
| `storage.bucket` | string | yes | — | Bucket that receives the outputs. |
| `storage.accessKeyId` | string | yes | — | Key with write access to the bucket. For R2, use a token scoped to this one bucket with Object Read & Write. |
| `storage.secretAccessKey` | string | yes | — | Never logged or echoed back by the server. |
| `storage.region` | string | no | `auto` | Use `auto` for R2, and the real region for AWS S3. |
| `storage.prefix` | string | no | `""` | Folder for the outputs. A missing trailing `/` is added. |
| `timeoutMinutes` | number | no | `60` | Limit on FFmpeg's own run time only (download and upload don't count). Must be 1 or more. |

### Command rules

- Write the command the way you would type it in bash, quotes included. No shell runs it, though. The server splits it into arguments and starts FFmpeg directly.
- These are rejected when they appear outside quotes: `|` `&` `;` `<` `>` `(` `)`, and `#` at the start of an argument. Put filter graphs in quotes, e.g. `-filter_complex "[0:v]scale=1280:720[v];[v][1:v]overlay"`.
- `$` and `*` reach FFmpeg exactly as written. Nothing expands them.
- **Inputs:** any argument that is exactly an `http://` or `https://` URL is downloaded first and swapped for a local path. Inputs must be URLs, not file paths on the server.
- **Outputs:** use plain file names with no folders, like `room-15.mp4` or `frame_%03d.png`. Every file FFmpeg writes in its working folder gets uploaded to `prefix + file name`, and an existing file with that key is overwritten.
- **Not supported:**
  - HLS playlists (`.m3u8`) as inputs
  - URLs inside filter text or concat list files (they are not downloaded)
  - video written to stdout (`-` or `pipe:1`)
  - absolute output paths (those files are never uploaded)
- A command that writes no files (for example `-f null -` for analysis) is fine. It returns `outputs: []`, and the answer is in `log`.

### Sizes and capacity

- Each input's size is read before the job starts. If an input doesn't report its size, the server counts it as 1 GB.
- A job sets aside disk space equal to 3.5× its total input size (the inputs plus room for outputs). If that is more than the server's whole disk budget (`MAX_DISK_GB`, default 65), you get `too_big`.
- The server runs at most `MAX_CONCURRENT_JOBS` jobs at once (default 4). When it's full you get `busy`.

## Response: quick errors (no stream)

Any of these come back with status `400`, `503`, or `500` and a JSON body:

```json
{"type":"error","reason":"busy","message":"All 4 job slots are in use","retryable":true,"details":{"slotsUsed":4,"slotsMax":4}}
```

- Every `503` also carries the header `Retry-After: 30` (in seconds). Wait that long before retrying.
- If the body isn't JSON (for example, something between you and the server failed), treat it as `retryable: true`.

## Response: the stream (status `200`)

The header is `Content-Type: application/x-ndjson`. The body is UTF-8, one JSON object per line, with lines separated by `\n`. A line arrives about every 10 seconds, and also whenever the step changes.

### Line types

**`started`** is always the first line:

```json
{"type":"started","jobId":"8f3c2a"}
```

**`progress`** is sent while the job runs:

```json
{"type":"progress","step":"download","elapsedSeconds":10,"bytesDone":314572800,"bytesTotal":734003200}
{"type":"progress","step":"ffmpeg","elapsedSeconds":95,"ffmpegTime":"00:04:12","speed":"2.1x"}
{"type":"progress","step":"upload","elapsedSeconds":610,"bytesDone":104857600,"bytesTotal":148012458}
```

- `step` is `download`, `ffmpeg`, or `upload`. `elapsedSeconds` counts from the start of the job.
- `ffmpegTime` and `speed` appear only once FFmpeg has reported them.

**`result`** is the last line when the job succeeds:

```json
{"type":"result","jobId":"8f3c2a","outputs":[{"key":"glitch/room-15/room-15.mp4","size":148012458,"contentType":"video/mp4"}],"exitCode":0,"ffmpegCommand":"ffmpeg -i /tmp/stream-ffmpeg/8f3c2a/in/0-bg.mp4 …","inputs":[{"url":"https://cdn.example.com/bg.mp4","size":734003200}],"timings":{"downloadSeconds":12,"ffmpegSeconds":540,"uploadSeconds":31},"log":"…","stdout":""}
```

| Field | Meaning |
| --- | --- |
| `outputs` | One entry per uploaded file: `key` (path in the bucket), `size` (bytes), `contentType`. Build URLs from `key` yourself. |
| `jobId` | Also appears in every server log line for this job. |
| `ffmpegCommand` | The exact command that ran, with local input paths. |
| `inputs` | Each input's URL (without its query string) and its size in bytes. |
| `timings` | Seconds spent on each step. |
| `log` | FFmpeg's log as a terminal shows it. If it's larger than 1 MB, the middle is cut. |
| `stdout` | FFmpeg's stdout, up to 1 MB. |

**`error`** is the last line when the job fails:

```json
{"type":"error","jobId":"8f3c2a","reason":"ffmpeg_failed","message":"FFmpeg exited with code 1","retryable":false,"details":{},"exitCode":1,"ffmpegCommand":"…","inputs":[…],"timings":{…},"log":"…","stdout":""}
```

- It has the same fields as a quick error. It also includes whichever `result` fields were known when the job failed.
- For `upload_failed`, `uploaded` lists the keys that were already uploaded. They stay in the bucket, and a retry overwrites them.

### Rules for reading the stream

- Read until a line has `type` `result` or `error`. That line is always the last.
- If the stream ends without one, the connection dropped. Treat that as a retryable failure.
- If no line arrives for 60 seconds, the job or the connection is stuck. Abort and retry.
- Ignore line types and fields you don't recognize. New ones may be added.

## Errors

Branch on `reason` and `retryable`. `message` is for people, and `details` holds extra facts for debugging (e.g. `httpStatus`, `url`, `storageCode`, slot and disk numbers). Don't build logic on `details`.

| `reason` | When | Comes as | `retryable` | What the caller should do |
| --- | --- | --- | --- | --- |
| `invalid_request` | Bad JSON, a missing field, or a rejected command | `400` | false | Fix the request |
| `too_big` | 3.5× the input size is more than the server's disk budget | `400` | false | Use smaller inputs, or raise `MAX_DISK_GB` |
| `busy` | No free job slot, or not enough disk right now | `503` | true | Wait `Retry-After`, then retry |
| `input_failed` | An input URL failed during sizing | `400` on a `4xx`, otherwise `503` | false on `400` | `400`: fix the URL. `503`: retry |
| `storage_rejected` | Wrong keys, missing bucket, or no write access | `400` | false | Fix `storage` |
| `storage_unreachable` | Storage timed out or returned `5xx` | `503` | true | Retry |
| `download_failed` | An input download failed after 3 tries | error line | false on `4xx`, true otherwise | Retry when retryable |
| `ffmpeg_failed` | FFmpeg exited with an error | error line | true only if the system killed FFmpeg (e.g. out of memory) | Read `log`; fix the command |
| `timeout` | FFmpeg ran longer than `timeoutMinutes` | error line | false | Raise `timeoutMinutes` or make the job smaller |
| `upload_failed` | An upload failed after its retries | error line | false if storage refused, true otherwise | Retry when retryable |
| `server_restarting` | The server is stopping, e.g. for a deploy | `503` or error line | true | Retry |
| `internal_error` | A server bug | `500` or error line | true | Retry, then report it with the `jobId` |

## Timeouts for the caller

- The server sends `200` within a few seconds, once the quick checks pass. After that a line arrives about every 10 seconds, so Node's default `fetch` timeouts (5 minutes) never trigger.
- Don't put a total time limit on the HTTP call that is shorter than download + `timeoutMinutes` + upload. Detect stalls by watching for silence instead (60 seconds with no line).

## Example: Temporal activity (TypeScript)

The storage keys come from the worker's env and never from activity input. Temporal saves activity inputs in its history, where anyone with UI access can read them.

```ts
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createInterface } from "node:readline";
import { Context, heartbeat, log } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";

export const streamFfmpeg = async (input: StreamFfmpegInput): Promise<StreamFfmpegResult> => {
  const response = await fetch(`${FFMPEG_SERVER_URL}/stream-ffmpeg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: input.command,
      timeoutMinutes: input.timeoutMinutes,
      storage: {
        endpoint: R2_ENDPOINT,
        bucket: R2_BUCKET,
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
        prefix: input.prefix,
      },
    }),
    // Cancelling or timing out the activity closes the connection, so the server stops the job.
    signal: Context.current().cancellationSignal,
  });

  if (response.status !== 200) {
    const error = await response.json().catch(() => ({
      reason: "bad_response",
      message: `HTTP ${response.status}`,
      retryable: true,
    }));
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? 0);
    throw ApplicationFailure.create({
      type: error.reason,
      message: error.message,
      nonRetryable: !error.retryable,
      nextRetryDelay: retryAfterSeconds > 0 ? `${retryAfterSeconds} seconds` : undefined,
      details: [error.details],
    });
  }

  const lines = createInterface({
    input: Readable.fromWeb(response.body as ReadableStream),
    crlfDelay: Infinity,
  });

  for await (const text of lines) {
    if (!text) continue;
    const line = JSON.parse(text);
    heartbeat(line.type === "progress" ? line : undefined);

    if (line.type === "result") {
      log.info("FFmpeg job done", { jobId: line.jobId, timings: line.timings });
      // Return only small fields. `log` can be up to 1 MB, which is too big for Temporal history.
      return { jobId: line.jobId, outputs: line.outputs, timings: line.timings };
    }

    if (line.type === "error") {
      log.warn("FFmpeg job failed", { jobId: line.jobId, reason: line.reason, log: line.log });
      throw ApplicationFailure.create({
        type: line.reason,
        message: `${line.message} (jobId ${line.jobId})`,
        nonRetryable: !line.retryable,
        details: [{ jobId: line.jobId, exitCode: line.exitCode, logTail: String(line.log ?? "").split("\n").slice(-50).join("\n") }],
      });
    }
  }

  throw ApplicationFailure.retryable("Stream ended without a result line", "connection_dropped");
};

type StreamFfmpegInput = { command: string; prefix: string; timeoutMinutes?: number };

type StreamFfmpegResult = {
  jobId: string;
  outputs: Array<{ key: string; size: number; contentType: string }>;
  timings: { downloadSeconds: number; ffmpegSeconds: number; uploadSeconds: number };
};
```

Read `FFMPEG_SERVER_URL`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` into top-level constants and validate them when the worker starts.

Workflow side:

```ts
const { streamFfmpeg } = proxyActivities<typeof activities>({
  heartbeatTimeout: "60 seconds", // a line arrives about every 10 s
  startToCloseTimeout: "90 minutes", // download + timeoutMinutes + upload
  scheduleToCloseTimeout: "4 hours", // total time, including waiting while the server is busy
  retry: { initialInterval: "30 seconds", backoffCoefficient: 2, maximumInterval: "5 minutes" },
});
```

- Don't set `maximumAttempts`. Busy retries can take many attempts, so `scheduleToCloseTimeout` is what bounds the total.
- Pick a stable `prefix` per job (e.g. `glitch/room-15/`), so that retries overwrite the same keys.

## Try it with curl

```bash
curl -N -X POST http://localhost:5675/stream-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i https://cdn.example.com/a.mp4 -t 5 -c:v libx264 clip.mp4",
    "storage": {
      "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
      "bucket": "videos",
      "accessKeyId": "<key id>",
      "secretAccessKey": "<secret>",
      "prefix": "test/"
    }
  }'
```

`-N` prints each line as soon as it arrives.

## Health

`GET /health` returns the FFmpeg version, the job slots in use, and the disk space set aside.
