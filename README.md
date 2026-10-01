# FFmpeg Server

An HTTP server that runs FFmpeg commands. `POST /stream-ffmpeg` downloads the inputs, runs FFmpeg, and uploads the outputs to your S3-compatible bucket (e.g. Cloudflare R2), streaming progress as it goes.

## How to Use

### Quick Start (Docker)

```bash
docker run -p 5675:5675 udaian/ffmpeg-server:latest
```

`/stream-ffmpeg` needs no other settings. The older `/execute-ffmpeg` also needs the Supabase variables (see [Environment Variables](#environment-variables)).

Verify it's running:

```bash
curl http://localhost:5675/health
```

### Endpoints

#### `GET /health`

Returns server status, FFmpeg version, and `/stream-ffmpeg` capacity (jobs running, disk set aside).

#### `POST /stream-ffmpeg` (recommended)

Runs one FFmpeg command. Inputs are URLs, outputs go to your bucket, and the reply streams one JSON line about every 10 seconds until a final `result` or `error` line.

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
    }
  }'
```

- When the server is full it answers `503` with `Retry-After: 30`; retry then.
- The result lists each output's `key`, `size`, and `contentType`; build URLs from `key`.
- Full contract (fields, every line type, error reasons, retry rules, a Temporal example): [docs/stream-ffmpeg-api.md](docs/stream-ffmpeg-api.md).

#### `POST /execute-ffmpeg`

Older endpoint: the whole job runs inside one silent HTTP call, so jobs over about 5 minutes get cut off by clients and proxies. Prefer `/stream-ffmpeg`.

Execute an FFmpeg command directly:

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i https://example.com/input.mp4 -vf scale=1280:720 output.mp4"
  }'
```

Request body:

| Field | Required | Description |
|-------|----------|-------------|
| `command` | Yes | FFmpeg command (must start with `ffmpeg `) |
| `supabaseBucket` | No | Override default storage bucket |
| `supabasePath` | No | Path prefix for uploaded files |

- Input files can be HTTP/HTTPS URLs (automatically downloaded)
- Shell operators (`>`, `|`, `&&`, etc.) are rejected
- 5-minute timeout per command

Response:

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

#### `POST /execute-ffprobe`

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

- Input files can be HTTP/HTTPS URLs (automatically downloaded)
- No output files — results are in `stdout`/`stderr`
- 1-minute timeout per command

Response:

```json
{
  "success": true,
  "stdout": "{ \"streams\": [...], \"format\": {...} }",
  "stderr": "",
  "exitCode": 0
}
```

## How to Deploy

### Docker

```bash
docker run -p 5675:5675 \
  -e MAX_CONCURRENT_JOBS=4 \
  -e MAX_DISK_GB=65 \
  udaian/ffmpeg-server:latest
```

### Railway

- Call the server over Railway's private network (`http://<service>.railway.internal:5675`). Public URLs cut requests off at 15 minutes.
- Don't attach a volume: job files are temporary, and a volume blocks replicas.
- Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` so running jobs can send their final `server_restarting` line before a deploy stops the server.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5675` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment (`development` / `production`) |
| `MAX_CONCURRENT_JOBS` | No | `4` | Most `/stream-ffmpeg` jobs running at once |
| `MAX_DISK_GB` | No | `65` | Disk budget for `/stream-ffmpeg` jobs; each sets aside 3.5x its input size |
| `SUPABASE_URL` | For `/execute-ffmpeg` | - | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For `/execute-ffmpeg` | - | Service role key for storage operations |
| `SUPABASE_BUCKET` | No | `ffmpeg-outputs` | Storage bucket name for `/execute-ffmpeg` |
| `MAX_OUTPUT_FILE_SIZE_BYTES` | No | `1073741824` | Max output file size for `/execute-ffmpeg` (1 GiB) |

### Supabase Setup (only for `/execute-ffmpeg`)

1. Create a project at [supabase.com](https://supabase.com)
2. Create a storage bucket (e.g. `ffmpeg-outputs`) and set it to **public**
3. Copy your project URL and service role key into the environment variables

### Release Process

1. Create and push a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Create a GitHub Release from the tag (this triggers the Docker build)
3. Multi-platform images (`linux/amd64`, `linux/arm64`) are published to Docker Hub as `udaian/ffmpeg-server`

## How to Contribute

### Setup

```bash
nvm use                              # Node v24.11.1
corepack enable
corepack prepare pnpm@10.1.0 --activate
pnpm install
cp .env.example .env                 # Fill in your credentials
```

### Development

```bash
pnpm dev     # Start dev server with hot reload
pnpm lint    # Run ESLint
pnpm build   # Lint + compile TypeScript
```

### Pull Request Expectations

1. Create a feature branch
2. Ensure `pnpm build` passes (lint + TypeScript compilation)
3. Pre-commit hooks run ESLint and Gitleaks automatically
4. Pre-push hooks run the full build
5. Follow existing code conventions: strict TypeScript, `import type` for type-only imports, no `console.log` without eslint-disable

## License

MIT
