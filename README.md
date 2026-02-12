# FFmpeg Server

A production-ready HTTP server for executing FFmpeg commands with automatic file upload to Supabase Storage.

## How to Use

### Quick Start (Docker)

```bash
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_supabase_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  udaian/ffmpeg-server:latest
```

Verify it's running:

```bash
curl http://localhost:5675/health
```

### Endpoints

#### `GET /health`

Returns server status and FFmpeg version.

#### `POST /execute-ffmpeg`

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

#### `POST /execute-llmpeg`

Convert natural language to FFmpeg commands using Claude AI:

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

Request body:

| Field | Required | Description |
|-------|----------|-------------|
| `task` | Yes | Natural language description of the FFmpeg task |
| `inputs` | Yes | Array of `{ url: string }` input files (min 1) |
| `supabaseBucket` | No | Override default storage bucket |
| `supabasePath` | No | Path prefix for uploaded files |

Response format is identical to `/execute-ffmpeg`.

Requires `ANTHROPIC_API_KEY` environment variable.

## How to Deploy

### Docker

```bash
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  -e ANTHROPIC_API_KEY=your_key \
  udaian/ffmpeg-server:latest
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5675` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment (`development` / `production`) |
| `SUPABASE_URL` | Yes | - | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Service role key for storage operations |
| `SUPABASE_BUCKET` | No | `ffmpeg-outputs` | Storage bucket name |
| `MAX_OUTPUT_FILE_SIZE_BYTES` | No | `104857600` | Max output file size in bytes (100MB) |
| `ANTHROPIC_API_KEY` | No* | - | Anthropic API key for `/execute-llmpeg` |

\* Required only if using the `/execute-llmpeg` endpoint.

### Supabase Setup

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
