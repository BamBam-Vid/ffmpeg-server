# FFmpeg Server

A production-ready HTTP server for executing FFmpeg commands with automatic file upload to Supabase Storage. Built with TypeScript, Express, and modern best practices.

## Features

- **Queue-based FFmpeg Processing** - Handles concurrent FFmpeg operations with intelligent CPU-based concurrency limits
- **Automatic File Upload** - Seamlessly uploads processed files to Supabase Storage with public URLs
- **Security First** - Command validation, shell operator blocking, and timeout protection
- **Multi-platform Support** - Pre-built images for `linux/amd64` and `linux/arm64`
- **Health Monitoring** - Built-in health check endpoint with FFmpeg version verification
- **Production Ready** - Comprehensive error handling, logging, and robust process management

## Quick Start

### Basic Usage

```bash
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_supabase_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  udaian/ffmpeg-server:latest
```

The server will be available at `http://localhost:5675`

### Test the Server

```bash
# Health check
curl http://localhost:5675/health

# Execute FFmpeg command
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -c:v libx264 -pix_fmt yuv420p output.mp4"
  }'
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5675` | HTTP server port |
| `SUPABASE_URL` | Yes | - | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Service role key for server-side operations |
| `SUPABASE_BUCKET` | No | `ffmpeg-outputs` | Storage bucket name for processed files |

## API Endpoints

### `GET /health`

Health check endpoint that verifies FFmpeg availability.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-06T10:30:00.000Z",
  "ffmpegVersion": "ffmpeg version 7.1"
}
```

### `POST /execute-ffmpeg`

Execute FFmpeg commands with automatic file upload to Supabase.

**Request Body:**
```json
{
  "command": "ffmpeg -i input.mp4 -vf scale=1280:720 output.mp4"
}
```

**Requirements:**
- Command MUST start with `ffmpeg ` (space after ffmpeg)
- Shell operators (`>`, `|`, `&&`, etc.) are not allowed
- Maximum execution time: 5 minutes
- File size limit: 100MB per output file

**Success Response (200):**
```json
{
  "success": true,
  "stdout": "",
  "stderr": "ffmpeg output logs...",
  "exitCode": 0,
  "outputs": [
    {
      "filename": "output.mp4",
      "path": "1733481000000-output.mp4",
      "url": "https://your-project.supabase.co/storage/v1/object/public/ffmpeg-outputs/1733481000000-output.mp4",
      "size": 1048576,
      "contentType": "video/mp4"
    }
  ]
}
```

**Error Response (4xx/5xx):**
```json
{
  "success": false,
  "error": "Error message",
  "errorType": "validation|timeout|spawn|execution|parse|storage",
  "details": [
    {
      "field": "command",
      "message": "Command must start with 'ffmpeg '"
    }
  ]
}
```

## Usage Examples

### Convert Video Format

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i input.mp4 -c:v libx264 -preset fast output.mp4"
  }'
```

### Extract Audio from Video

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i video.mp4 -vn -acodec libmp3lame -q:a 2 audio.mp3"
  }'
```

### Generate Thumbnail

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i video.mp4 -ss 00:00:05 -vframes 1 thumbnail.jpg"
  }'
```

### Create Video from Test Pattern

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -c:v libx264 -pix_fmt yuv420p test.mp4"
  }'
```

### Multiple Output Files

```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i input.mp4 -vf scale=1920:1080 hd.mp4 -vf scale=1280:720 sd.mp4"
  }'
```

## Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  ffmpeg-server:
    image: udaian/ffmpeg-server:latest
    ports:
      - "5675:5675"
    environment:
      - PORT=5675
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_BUCKET=ffmpeg-outputs
    restart: unless-stopped
```

Run with:
```bash
docker-compose up -d
```

## Advanced Configuration

### Custom Port

```bash
docker run -p 8080:8080 \
  -e PORT=8080 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  udaian/ffmpeg-server:latest
```

### Volume Mounting (for debugging)

```bash
docker run -p 5675:5675 \
  -v $(pwd)/logs:/app/logs \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  udaian/ffmpeg-server:latest
```

### Resource Limits

```bash
docker run -p 5675:5675 \
  --cpus="2.0" \
  --memory="4g" \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  udaian/ffmpeg-server:latest
```

## Architecture

### Queue Management
- Concurrent FFmpeg processes: `min(max(floor(CPU_COUNT / 2), 2), 8)`
- Example: 16 CPU system = 8 concurrent processes
- Automatically prevents resource exhaustion

### File Processing Flow
1. Validate FFmpeg command
2. Parse output file paths
3. Create temporary directory
4. Execute FFmpeg with temp paths
5. Upload all outputs to Supabase Storage
6. Return public URLs with metadata
7. Clean up temporary files

### Security Features
- Command validation (must start with `ffmpeg `)
- Shell operator blocking (`>`, `|`, `&&`, etc.)
- 5-minute execution timeout
- 100MB file size limit per output
- No arbitrary code execution

## Troubleshooting

### FFmpeg Not Found
If you see "Failed to spawn FFmpeg process", the image should include FFmpeg. Verify with:
```bash
docker run udaian/ffmpeg-server:latest ffmpeg -version
```

### Connection Refused
Ensure the port mapping matches the `PORT` environment variable:
```bash
docker run -p 5675:5675 -e PORT=5675 udaian/ffmpeg-server:latest
```

### Supabase Upload Failures
Check your environment variables:
```bash
# Test with debug output
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  udaian/ffmpeg-server:latest
```

### Timeout Errors
For longer operations, consider:
- Breaking large files into chunks
- Using faster encoding presets (`-preset ultrafast`)
- Increasing resources with `--cpus` and `--memory`

## Supported Platforms

- `linux/amd64` (x86_64)
- `linux/arm64` (ARM64/Apple Silicon)

Built on Node.js v24.11.1 with FFmpeg 7.1

## Version Tags

- `latest` - Latest stable release
- `1` - Major version 1
- `1.0` - Minor version 1.0
- `1.0.0` - Specific patch version

## Links

- **GitHub Repository**: https://github.com/udaian/ffmpeg-server
- **Docker Hub**: https://hub.docker.com/r/udaian/ffmpeg-server
- **Issue Tracker**: https://github.com/udaian/ffmpeg-server/issues

## License

MIT License - See LICENSE file for details

## Author

Udayan Maurya

---

**Note:** This server is designed for controlled environments. Always validate and sanitize FFmpeg commands in production. Never expose directly to untrusted users without additional authentication and authorization layers.
