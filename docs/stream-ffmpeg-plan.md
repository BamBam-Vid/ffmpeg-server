# stream-ffmpeg plan

Part 1 is decided. Part 2 is next.

## Goal

- Add a new endpoint, `POST /stream-ffmpeg`. It runs an FFmpeg command whose inputs are URLs and uploads the outputs to the caller's bucket.
- Sizes: inputs up to ~1 GB each, outputs up to ~5 GB. Many jobs can arrive at once.
- Main caller: the Temporal activity `renderGlitchRoomVideo` in `attention-temporal-workflows`. It runs in the same Railway project.

## Why

- A job runs inside one HTTP call that sends nothing until it finishes. Railway's public proxy closes the call after 5 minutes with no data, and Node `fetch` gives up after 5 minutes, so the caller sees `fetch failed`.
- Too many jobs run at once. Production allows 80% of `os.cpus()`, and inside a container that can be the host machine's core count.
- Whole files are held in memory for both download and upload.
- The 100 MB output limit is checked only after the render finishes, so the work is wasted.
- Outputs are found by guessing from a hand-kept list of FFmpeg flags.

## Decisions

- `/execute-ffmpeg` and `/execute-ffprobe` stay unchanged, so Supabase stays for them.
- No queue on the server. When it's busy it replies `503` with `Retry-After: 30` (seconds), and Temporal retries.
- The server is busy when no job slot is free or the job's disk estimate doesn't fit.
- Disk estimate = 3.5× the total input size (the inputs themselves plus 2.5× for outputs). Input sizes come from 1-byte range requests.
- Results come back on one streaming call: one JSON object per line, a progress line about every 10 s, then one final line.
- Railway: one replica, no volume, the 100 GB temporary disk. The caller uses the private network only, since public URLs are cut off at 15 min.
- Storage: S3 multipart upload to the caller's S3-compatible bucket (R2). Keys come in each request. They are never logged, stored, or passed to FFmpeg. The Temporal activity reads them from its own env, not from activity input.
- Each output comes back as its key (path), size, and content type only. The caller builds URLs.
- Env vars (optional): `MAX_CONCURRENT_JOBS` (default 4) and `MAX_DISK_GB` (default 65).

## Part 1: API (decided)

Request:

```json
{
  "command": "ffmpeg -i https://cdn.example.com/a.mp4 -c:v libx264 room-15.mp4",
  "storage": {
    "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
    "region": "auto",
    "bucket": "videos",
    "accessKeyId": "…",
    "secretAccessKey": "…",
    "prefix": "glitch/room-15/"
  },
  "timeoutMinutes": 60
}
```

- `command` starts with `ffmpeg ` and is quoted the way you would type it in a terminal. Shell symbols (`|`, `>`, `&&`) are rejected because no shell runs. The error names the symbol and how to fix it.
- Any argument that is exactly an `http(s)://` URL is an input.
- Outputs are plain file names. Each one is saved at `prefix + name`, and an existing file at that key is overwritten.
- Defaults: `region` `auto`, `prefix` the bucket root, `timeoutMinutes` 60.
- `timeoutMinutes` limits only FFmpeg's own run time. When it runs out, FFmpeg is stopped and the reason is `timeout`.

Quick failures come back as plain JSON, using the same shape as the stream's error line:

- `400`: retrying won't help. Examples: a bad command, an input that returns 404, rejected storage keys.
- `503` + `Retry-After: 30`: the server is busy, or reaching an input or the bucket failed temporarily. A busy reply says which check failed.

Otherwise the server replies `200` and streams lines:

```
{"type":"started","jobId":"8f3c2a"}
{"type":"progress","step":"download","elapsedSeconds":10}
{"type":"progress","step":"ffmpeg","elapsedSeconds":20}
{"type":"progress","step":"upload","elapsedSeconds":610}
{"type":"result","jobId":"8f3c2a","outputs":[{"key":"glitch/room-15/room-15.mp4","size":148012458,"contentType":"video/mp4"}],"exitCode":0,"ffmpegCommand":"…","inputs":[{"url":"…","size":734003200}],"timings":{"downloadSeconds":12,"ffmpegSeconds":540,"uploadSeconds":31},"log":"…"}
```

The last line is either `result` or `error`:

```
{"type":"error","jobId":"8f3c2a","reason":"ffmpeg_failed","message":"FFmpeg exited with code 1","retryable":false,"exitCode":1,"log":"…"}
```

- If neither final line arrives, the connection dropped and the caller should retry.
- If the command writes no files, the result has `outputs: []`.
- Debug info in every final line:
  - `jobId`, which also appears in the server logs
  - the exact command that ran (with local paths)
  - each input's URL (without its query string) and size
  - step timings
  - the exit code
  - the full FFmpeg log (if it's huge, only the start and end are kept)
  - for errors: `reason`, `message`, `retryable`, and the underlying detail (an input's HTTP status, or a storage error code)
- Storage keys never appear in responses or logs.

## Part 2: Busy check (decided)

1. Validate the request.
2. Take a job slot. If none is free, reply `503`.
3. Size each input with a 1-byte request. If a size isn't reported, count it as 1 GB.
4. Check the disk. If the job doesn't fit, reply `503`. If it can never fit (estimate > `MAX_DISK_GB`), reply `400`.
5. Check the storage keys (part 3), then start the stream.

- If anything fails after step 2, the slot is given back.
- A job keeps its slot until the stream ends: result, error, or caller disconnect.
- Disk estimate = 3.5× the total input size.
- A job fits only when both are true:
  - space already set aside + the estimate ≤ `MAX_DISK_GB`
  - the estimate ≤ real free space (`fs.statfs`) minus the space set aside
- A job's set-aside space is freed when its folder is deleted.
- A `503` includes `Retry-After: 30` and the numbers behind it, e.g. "all 4 job slots in use" or "needs 12.3 GB, 9.1 GB left of 65 GB".
- There is no fairness: a big job can wait longer while small ones keep fitting. That's fine for now.
- `/health` also shows slots in use and the disk space set aside.

## Part 3: Storage check (decided)

Before downloading any inputs, the server starts a multipart upload at the job's prefix and aborts it right away. This proves the endpoint, bucket, keys, and write access all work, and it leaves no file behind.

- If the storage refuses (wrong keys, no write access, missing bucket), reply `400` with the storage error code (`AccessDenied`, `NoSuchBucket`).
- If the storage can't be reached (timeout or `5xx`), reply `503`. The caller can retry.
- The check gets 15 seconds.
- If `prefix` doesn't end in `/`, one is added.
- If the abort fails, R2 deletes the empty upload on its own after 7 days.

## Part 4: Inputs (decided)

- Sizing happens in part 2, before the stream starts. The server requests only the first byte, and the reply carries the full file size. A `404` or `403` returns `400`. A timeout or `5xx` returns `503`.
- Downloading is the first step of the stream. Each file is written straight to disk and never held in memory. Each job downloads at most 4 files at a time.
- If the same URL appears twice, it is downloaded once.
- Files are saved as `in/<n>-<name from the URL>`. The extension is kept because FFmpeg sometimes uses it to detect the format.
- Network errors and `5xx` get up to 3 tries, and each retry restarts that file. A `4xx` fails right away. Receiving nothing for 60 s counts as a failed try.
- During this step, progress lines show bytes done out of the total.
- If downloading fails, the error is `download_failed` with the URL and HTTP status. It is retryable unless the status was `4xx`.
- If a file whose size wasn't reported turns out larger than 1 GB, the job's set-aside disk space is raised to match.
- Logs drop each URL's query string, because signed URLs keep their signature there.
- Not supported: HLS playlists (`.m3u8`), or URLs inside filter text or list files. Only an argument that is exactly a URL gets downloaded.

## Part 5: Run (decided)

- Folders: `/tmp/stream-ffmpeg/<jobId>/in` holds the downloads and `/out` is FFmpeg's working folder. Every file FFmpeg writes in `out` counts as an output.
- The command is split into arguments the way a terminal would. URL arguments are replaced with the downloaded file paths, and FFmpeg is started directly with no shell.
- FFmpeg's environment contains only `PATH`, and it runs as a separate low-privilege user. That way it can't read the server's env, memory, or files.
- stdin is closed, so FFmpeg can never sit waiting at a prompt.
- If FFmpeg runs past `timeoutMinutes`, it is killed and the job ends with `timeout`.
- If the caller disconnects, FFmpeg is killed and any download or upload in progress stops. The job folder is then deleted and the slot and disk space are freed.
- Progress lines include FFmpeg's position and speed (`"ffmpegTime":"00:04:12","speed":"2.1x"`).
- The log is kept the way a terminal shows it. If it goes past 1 MB, the middle is cut.
- stdout is kept up to 1 MB. Writing video to stdout (`pipe:1`, `-`) isn't supported.
- Exit code 0 moves on to upload (part 6). Any other exit ends the job with `ffmpeg_failed`, the exit code, and the log. If the system killed FFmpeg (for example, out of memory), the error says so.

## Part 6: Upload (decided)

- Every file in `out` is uploaded, one file at a time, to `prefix + file name`. If a file already exists at that key, it is overwritten.
- Each file streams from disk in 16 MB parts, with 4 parts uploading at once. That caps memory at about 64 MB per job. Files smaller than one part go up in a single request.
- The content type comes from the file extension. If the extension isn't recognized, it is `application/octet-stream`.
- A failed part is retried on its own, up to 3 times. An upload that makes no progress for 60 s counts as failed.
- When an upload fails:
  - The unfinished upload is aborted.
  - The job ends with `upload_failed` and the storage error code. It is retryable unless the storage refused the request (e.g. `AccessDenied`).
  - Files that were already uploaded stay in the bucket and are listed in the error. A retry overwrites them.
- During this step, progress lines show bytes uploaded out of the total.
- The result lists each output's key, size, and content type. After that, the job folder is deleted, and its disk space and slot are freed.

## Part 7: Errors and logs (decided)

| `reason` | When | Comes back as | Retryable |
| --- | --- | --- | --- |
| `invalid_request` | Bad command or fields, or an unquoted shell symbol | `400` | No |
| `too_big` | Disk estimate is larger than `MAX_DISK_GB` | `400` | No |
| `busy` | No free slot, or the job doesn't fit on disk right now | `503` | Yes |
| `input_failed` | Sizing an input failed | `400` on a `4xx`, otherwise `503` | Only when `503` |
| `storage_rejected` | Bad keys, bucket, or permission | `400` | No |
| `storage_unreachable` | Storage timed out or returned `5xx` | `503` | Yes |
| `download_failed` | A download failed after its retries | error line | Yes, unless `4xx` |
| `ffmpeg_failed` | FFmpeg exited with an error | error line | Only if the system killed it (e.g. out of memory) |
| `timeout` | FFmpeg ran past `timeoutMinutes` | error line | No |
| `upload_failed` | An upload failed after its retries | error line | Yes, unless storage refused |
| `server_restarting` | The server is stopping (e.g. a deploy) | error line | Yes |
| `internal_error` | A server bug | `500` or error line | Yes |

- Retryable: the caller retries, waiting `Retry-After` first on a `503`, otherwise using Temporal's backoff. Not retryable: the caller fails the step.
- Server logs are JSON lines on stdout, each with `level` and `jobId`. Railway shows them as searchable fields.
- What gets logged:
  - job accepted, with input count, total size, and the disk estimate
  - busy rejections, with the numbers behind them
  - when each step starts and ends, with its duration
  - every retry and its cause
  - FFmpeg's exit code and duration
  - the outputs, with key and size
  - errors
  - caller disconnects
- When FFmpeg fails, the last 100 lines of its log are logged too. When it succeeds, its log only goes in the response.
- Never logged: storage keys, URL query strings, request bodies.

## Part 8: Startup and shutdown (decided)

Startup:
- Read `MAX_CONCURRENT_JOBS` (default 4) and `MAX_DISK_GB` (default 65). If either is set to an invalid value, refuse to start with a clear error. Don't fall back to the default silently.
- Delete `/tmp/stream-ffmpeg/`, which holds folders left over from jobs that were cut off.
- Check that FFmpeg runs and log its version. If it doesn't run, refuse to start.
- If the server runs as root (as in Docker), FFmpeg runs as the low-privilege `ffmpeg` user. Otherwise (local dev), it runs as the current user.

Shutdown (when Railway stops the server):
1. New requests get `503` with `server_restarting`.
2. Running jobs are stopped: FFmpeg is killed and each stream ends with a `server_restarting` error line.
3. Job folders are deleted, then the server exits.

- Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` to about 10 so those lines get sent before the hard kill. If they aren't sent, the stream ends without a final line and the caller retries anyway.
- A deploy restarts any running jobs from the beginning, so it's best to deploy when no jobs are running.

## Part 10: Caller (decided, lives in the Temporal repo)

- Activity input: the command, `prefix`, and `timeoutMinutes`. The storage keys are not part of it.
- The keys come from the worker's env: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- The server address comes from `FFMPEG_SERVER_URL=http://<service>.railway.internal:5675`.
- Pass Temporal's cancellation signal to `fetch`. If the activity is cancelled or times out, the connection closes and the server kills FFmpeg.
- On `503`: retry after `Retry-After`, using `nextRetryDelay`.
- On `400` or `500`: fail without retrying when `retryable` is false.
- On `200`: read the stream one line at a time and heartbeat on each line. Then:
  - `result`: return the outputs, `jobId`, and timings. Write the FFmpeg log to the worker's logs, not the return value, because of Temporal's payload size limit.
  - `error`: throw. The failure is non-retryable when `retryable` is false. Include the reason, message, `jobId`, and the last 50 lines of the log.
  - The stream ends with no final line: the connection dropped, so retry.
- Temporal settings:
  - heartbeat timeout: 60 s
  - start-to-close: 90 min
  - schedule-to-close: 4 h, with no cap on attempts
  - backoff: 30 s, doubling each time, up to 5 min
- After a success, the workflow builds URLs from the returned keys. A retry overwrites the same keys.

## Part 11: Docs (proposed)

- `docs/stream-ffmpeg-api.md` is the full guide for callers and their AI agents. It's already written and acts as the contract.
- `README.md` gets a short `/stream-ffmpeg` section that links to the guide, adds `MAX_CONCURRENT_JOBS` and `MAX_DISK_GB` to the env table, and adds Railway notes (private network, no volume, 10 s draining). The old endpoints are marked as the older way.
- `DOCKER_HUB_OVERVIEW.md` gets the same changes, kept shorter, and links to the guide on GitHub.
- `AGENTS.md` gets an updated one-line description and links to the plan and the guide.

## Parts

- [x] 2. Busy check
- [x] 3. Storage check
- [x] 4. Inputs
- [x] 5. Run
- [x] 6. Upload
- [x] 7. Errors and logs
- [x] 8. Startup and shutdown
- [x] 9. Railway: one replica, no volume, private network only
- [x] 10. Caller
- [ ] 11. Docs: README, Docker Hub overview, `AGENTS.md`

## Open questions

- None. (Resolved: on Railway, `df -h /tmp` shows the host's shared 1.9 TB disk with 545 GB free, not the 100 GB limit. So `MAX_DISK_GB` stays as the cap, defaulting to 65. A job also has to fit in the real free space that `fs.statfs` reports, which keeps smaller machines safe without any setup.)
