# FFmpeg Server

A production-ready HTTP server for executing FFmpeg commands with automatic file upload to Supabase Storage.

## How to Deploy

```bash
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_supabase_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  udaian/ffmpeg-server:latest
```

Test it:

```bash
curl http://localhost:5675/health
```

### Environment Variables

**Required:**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for storage operations |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5675` | HTTP server port |
| `NODE_ENV` | `development` | Environment (`development` / `production`) |
| `SUPABASE_BUCKET` | `ffmpeg-outputs` | Storage bucket name |
| `MAX_OUTPUT_FILE_SIZE_BYTES` | `104857600` | Max output file size in bytes (100MB) |
| `ANTHROPIC_API_KEY` | - | Required only for `/execute-llmpeg` endpoint |

### Supported Platforms

- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

### Version Tags

- `latest` — Latest stable release
- `1` / `1.0` / `1.0.0` — Semantic version pinning

## How `execute-ffmpeg` Works

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

### `POST /execute-llmpeg`

Convert natural language to FFmpeg commands using Claude AI. Requires `ANTHROPIC_API_KEY`.

```bash
curl -X POST http://localhost:5675/execute-llmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "task": "concatenate these videos one after another",
    "inputs": [
      {"url": "https://example.com/video1.mp4"},
      {"url": "https://example.com/video2.mp4"}
    ]
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `task` | Yes | Natural language description of the FFmpeg task |
| `inputs` | Yes | Array of `{ url: string }` input files (min 1) |
| `supabaseBucket` | No | Override default storage bucket |
| `supabasePath` | No | Path prefix for uploaded files |

Response format is identical to `/execute-ffmpeg`.

## Links

- [GitHub](https://github.com/udaian/ffmpeg-server)
- [Issue Tracker](https://github.com/udaian/ffmpeg-server/issues)

## License

MIT
