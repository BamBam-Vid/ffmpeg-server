# FFmpeg Server

An HTTP server that runs FFmpeg commands. `POST /stream-ffmpeg` downloads the inputs, runs FFmpeg, and uploads the outputs to your S3-compatible bucket (e.g. Cloudflare R2), streaming progress as it goes.

## How to Deploy

```bash
docker run -p 5675:5675 udaian/ffmpeg-server:latest
```

Test it:

```bash
curl http://localhost:5675/health
```

On Railway: call the server over the private network (`http://<service>.railway.internal:5675`), don't attach a volume, and set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10`.

### Environment Variables

**Required:** none for `/stream-ffmpeg`. The older `/execute-ffmpeg` needs:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for storage operations |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5675` | HTTP server port |
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `MAX_CONCURRENT_JOBS` | `4` | Most `/stream-ffmpeg` jobs running at once |
| `MAX_DISK_GB` | `65` | Disk budget for `/stream-ffmpeg` jobs; each sets aside 3.5x its input size |
| `SUPABASE_BUCKET` | `ffmpeg-outputs` | Storage bucket name for `/execute-ffmpeg` |
| `MAX_OUTPUT_FILE_SIZE_BYTES` | `1073741824` | Max output file size for `/execute-ffmpeg` (1 GiB) |

### Supported Platforms

- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

### Version Tags

- `latest` — Latest stable release
- `1` / `1.0` / `1.0.0` — Semantic version pinning

## How `stream-ffmpeg` Works

### Request

```bash
curl -N -X POST http://localhost:5675/stream-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i https://example.com/input.mp4 -vf scale=1280:720 output.mp4",
    "storage": {
      "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
      "bucket": "videos",
      "accessKeyId": "<key id>",
      "secretAccessKey": "<secret>",
      "prefix": "renders/"
    },
    "timeoutMinutes": 60
  }'
```

**Command rules:**

- Must start with `ffmpeg ` and is quoted as in a terminal; unquoted shell symbols (`|`, `>`, `&&`, `;`) are rejected because no shell runs
- Every argument that is exactly an `http(s)://` URL is downloaded first
- Outputs are plain file names; each is uploaded to `prefix + name`, overwriting an existing file
- `timeoutMinutes` (default 60) limits FFmpeg's own run time

### Response

- Quick failures come back as JSON with `400` (fix the request), `503` + `Retry-After: 30` (busy or temporary, retry), or `500`.
- Otherwise `200` and one JSON line about every 10 seconds, ending with one `result` or `error` line:

```
{"type":"started","jobId":"8f3c2a"}
{"type":"progress","step":"ffmpeg","elapsedSeconds":95,"ffmpegTime":"00:04:12","speed":"2.1x"}
{"type":"result","jobId":"8f3c2a","outputs":[{"key":"renders/output.mp4","size":148012458,"contentType":"video/mp4"}],"exitCode":0,"timings":{"downloadSeconds":12,"ffmpegSeconds":540,"uploadSeconds":31},"log":"…"}
```

Full contract: [stream-ffmpeg API guide](https://github.com/udaian/ffmpeg-server/blob/main/docs/stream-ffmpeg-api.md).

## How `execute-ffmpeg` Works

Older endpoint: the whole job runs inside one silent HTTP call, so jobs over about 5 minutes get cut off by clients and proxies. Prefer `/stream-ffmpeg`.

Send FFmpeg commands via `POST /execute-ffmpeg`. The server validates the command, executes it, uploads output files to Supabase Storage, and returns public URLs.

### Request

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i https://example.com/input.mp4 -vf scale=1280:720 output.mp4"
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | FFmpeg command (must start with `ffmpeg `) |
| `supabaseBucket` | No | Override default storage bucket |
| `supabasePath` | No | Path prefix for uploaded files |

**Command rules:**

- Must start with `ffmpeg `
- Input files can be HTTP/HTTPS URLs (automatically downloaded)
- Shell operators (`>`, `|`, `&&`, etc.) are rejected
- 5-minute timeout per command

### Response

**Success (200):**

```json
{
  "success": true,
  "outputs": [
    {
      "filename": "output.mp4",
      "path": "1733481000000-output.mp4",
      "url": "https://your-project.supabase.co/storage/v1/object/public/ffmpeg-outputs/1733481000000-output.mp4",
      "size": 1048576,
      "contentType": "video/mp4"
    }
  ],
  "stdout": "",
  "stderr": "ffmpeg output logs...",
  "exitCode": 0
}
```

**Error (4xx/5xx):**

```json
{
  "success": false,
  "error": "Error message",
  "errorType": "validation|timeout|spawn|execution|parse|storage"
}
```

## Other Endpoints

### `GET /health`

Returns server status and FFmpeg version.

### `POST /execute-ffprobe`

Inspect a media file with FFprobe:

```bash
curl -X POST http://localhost:5675/execute-ffprobe \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffprobe -v quiet -print_format json -show_format -show_streams https://example.com/input.mp4"
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | FFprobe command (must start with `ffprobe `) |

Returns `{ success, stdout, stderr, exitCode }`. No output files — results are in `stdout`.

## Links

- [GitHub](https://github.com/udaian/ffmpeg-server)
- [Issue Tracker](https://github.com/udaian/ffmpeg-server/issues)

## License

MIT
