# FFmpeg Server

A production-ready HTTP server for executing FFmpeg commands with automatic file upload to Supabase Storage. Built with TypeScript, Express, and modern best practices.

## What Does This Do?

This server provides a REST API for executing FFmpeg commands remotely. It:

- **Accepts FFmpeg commands via HTTP POST** - Send any FFmpeg command as JSON
- **Natural language processing** - NEW: Convert plain English to FFmpeg commands using Claude AI
- **Manages concurrent processing** - Queue-based system prevents resource exhaustion
- **Automatic input downloads** - Fetches files from HTTP/HTTPS URLs before processing
- **Uploads results to Supabase Storage** - Automatically stores processed files and returns public URLs
- **Provides robust error handling** - Categorizes errors (validation, timeout, execution, storage)
- **Ensures security** - Validates commands, blocks shell operators, enforces timeouts

### Use Cases

- Video transcoding services
- Thumbnail generation
- Audio extraction and conversion
- Video format conversion
- Batch media processing
- Serverless FFmpeg operations

## Quick Start (Docker)

The fastest way to run the server:

```bash
docker run -p 5675:5675 \
  -e SUPABASE_URL=your_supabase_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  -e ANTHROPIC_API_KEY=your_anthropic_api_key \
  udaian/ffmpeg-server:latest
```

Test it:
```bash
curl http://localhost:5675/health
```

## Development Setup

### Prerequisites

- Node.js v24.11.1 (see [.nvmrc](./.nvmrc))
- pnpm 10.1.0
- [Gitleaks](https://github.com/gitleaks/gitleaks) (optional, for secret detection)
- FFmpeg installed locally (for development testing)
- Supabase account (for storage integration)

### 1. Install Node.js version

```bash
nvm install
nvm use
```

### 2. Install pnpm

```bash
corepack enable
corepack prepare pnpm@10.1.0 --activate
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Create environment file

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
PORT=5675
NODE_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=ffmpeg-outputs
ANTHROPIC_API_KEY=your-anthropic-api-key
```

### 5. Set up Supabase Storage

1. Create a Supabase project at https://supabase.com
2. Create a storage bucket named `ffmpeg-outputs` (or your custom name)
3. Set bucket to **public** for file access
4. Copy your project URL and service role key to `.env`

### 6. Run development server

```bash
pnpm dev
```

The server will start on `http://localhost:5675`.

## API Usage

### Health Check

```bash
curl http://localhost:5675/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-06T10:30:00.000Z",
  "ffmpegVersion": "ffmpeg version 7.1"
}
```

### Execute FFmpeg Command

**Direct FFmpeg Command:**
```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -c:v libx264 -pix_fmt yuv420p output.mp4"
  }'
```

**With URL Inputs (automatically downloaded):**
```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i https://example.com/video1.mp4 -i https://example.com/video2.mp4 -filter_complex \"[0:v][1:v]concat=n=2:v=1:a=0\" output.mp4"
  }'
```

Response:
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

### Execute with Natural Language (LLMpeg)

**NEW:** Convert plain English to FFmpeg commands using Claude AI:

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

The server will:
1. Download input files
2. Use Claude AI to generate appropriate FFmpeg command
3. Execute the command
4. Upload and return results

Response format is identical to `/execute-ffmpeg`.

## Available Scripts

- `pnpm dev` - Start development server with hot reload (nodemon + tsx)
- `pnpm build` - Lint and compile TypeScript to JavaScript
- `pnpm start` - Start production server from compiled code
- `pnpm lint` - Run ESLint with auto-fix

## Architecture

### Key Components

- **Express Server** ([src/index.ts](src/index.ts)) - HTTP server setup with CORS and middleware
- **FFmpeg Executor** ([src/execute-ffmpeg.ts](src/execute-ffmpeg.ts)) - Queue management and FFmpeg process execution
- **FFmpeg Utils** ([src/lib/ffmpeg-utils.ts](src/lib/ffmpeg-utils.ts)) - File parsing, temp directory management, Supabase uploads

### How It Works

1. **Request Validation** - Validates command starts with `ffmpeg ` using Zod
2. **Argument Parsing** - Uses `shell-quote` to safely parse FFmpeg arguments
3. **Security Checks** - Blocks shell operators (`>`, `|`, `&&`, etc.)
4. **Queue Management** - Adds job to `p-queue` with CPU-based concurrency limits
5. **Temp Directory** - Creates temporary directory for output files
6. **FFmpeg Execution** - Spawns FFmpeg process with modified output paths
7. **File Upload** - Uploads all output files to Supabase Storage
8. **Cleanup** - Removes temporary files after upload
9. **Response** - Returns public URLs with file metadata

### Queue Configuration

Concurrent FFmpeg processes = `min(max(floor(CPU_COUNT / 2), 2), 8)`

- 4 CPU system = 2 concurrent processes
- 8 CPU system = 4 concurrent processes
- 16+ CPU system = 8 concurrent processes (max)

### Security Features

- Command must start with `ffmpeg ` (validation)
- Shell operators rejected (`>`, `|`, `&&`, `||`, `;`)
- 5-minute timeout per FFmpeg process
- 100MB file size limit per output
- No arbitrary code execution

## Tech Stack

- **Runtime**: Node.js v24.11.1
- **Language**: TypeScript 5.8+ with strict mode
- **Framework**: Express 5.x
- **FFmpeg Processing**: child_process.spawn, p-queue
- **Storage**: Supabase Storage (@supabase/supabase-js)
- **Validation**: Zod 4.x
- **Argument Parsing**: shell-quote
- **Package Manager**: pnpm 10.1.0
- **Code Quality**: ESLint 9+ (flat config), Prettier
- **Git Hooks**: Husky 9
- **Security**: Gitleaks for secret detection

## Project Structure

```
ffmpeg-server/
├── .github/
│   └── workflows/
│       ├── build.yml           # CI: Lint + build on push/PR
│       └── docker-release.yml  # CD: Build & push Docker images
├── .husky/                     # Git hooks
│   ├── pre-commit              # Runs ESLint + Gitleaks
│   └── pre-push                # Runs build
├── .vscode/                    # VSCode configuration
│   ├── settings.json           # Editor settings (format on save)
│   └── launch.json             # Debug configuration (F5 to debug)
├── src/
│   ├── index.ts                # Server entry point
│   ├── execute-ffmpeg.ts       # FFmpeg execution handler
│   ├── execute-llmpeg.ts       # Natural language FFmpeg handler
│   ├── middleware/
│   │   └── request-id.ts       # Request ID generation
│   ├── types/
│   │   └── express.d.ts        # Express type extensions
│   └── lib/
│       ├── ffmpeg-execution.ts # Shared FFmpeg execution logic
│       ├── ffmpeg-utils.ts     # File parsing, temp dirs, Supabase uploads
│       ├── llmpeg-converter.ts # Claude AI integration
│       ├── input-download.ts   # URL downloading with queue
│       └── request-workspace.ts # Request-scoped temp directories
├── dist/                       # Compiled JavaScript (gitignored)
├── package.json                # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration (strict mode)
├── eslint.config.js            # ESLint flat config
├── .prettierrc                 # Prettier configuration
├── .nvmrc                      # Node version (v24.11.1)
├── Dockerfile                  # Multi-stage Docker build
├── .dockerignore               # Docker ignore patterns
├── CLAUDE.md                   # Claude Code instructions
└── README.md                   # This file
```

## Contributing

We welcome contributions! Here's how to get started:

### Development Workflow

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ffmpeg-server.git
   cd ffmpeg-server
   ```

2. **Set Up Environment** (see Development Setup above)

3. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Make Your Changes**
   - Write code in `src/`
   - Follow existing code style
   - Use TypeScript strict mode
   - Add types for all functions

5. **Test Your Changes**
   ```bash
   # Run the dev server
   pnpm dev

   # In another terminal, test the API
   curl http://localhost:5675/health
   ```

6. **Lint Your Code**
   ```bash
   pnpm lint
   ```

7. **Build to Verify**
   ```bash
   pnpm build
   ```

8. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

   Pre-commit hooks will automatically:
   - Run ESLint
   - Run Gitleaks to detect secrets

9. **Push Your Branch**
   ```bash
   git push origin feature/your-feature-name
   ```

   Pre-push hooks will automatically:
   - Run full build to ensure compilation succeeds

10. **Create a Pull Request**
    - Go to GitHub and create a PR from your branch
    - Describe your changes clearly
    - Link any related issues

### Code Style Guidelines

- **TypeScript Strict Mode** - All code must pass strict type checking
- **No Console Logs** - Use `// eslint-disable-next-line no-console` only when necessary
- **Explicit Types** - Avoid `any`, use proper types or `unknown`
- **Prefer const** - Use `const` over `let` when possible
- **Unused Variables** - Prefix with `_` (e.g., `_req`, `_unused`)
- **ES Modules** - Use `import/export`, not `require()`
- **Type Imports** - Use `import type` for type-only imports

### Testing Changes

**Health Check:**
```bash
curl http://localhost:5675/health
```

**Test FFmpeg Execution:**
```bash
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -f lavfi -i testsrc=duration=5:size=640x480:rate=30 -c:v libx264 test.mp4"
  }'
```

**Test Error Handling:**
```bash
# Invalid command (doesn't start with ffmpeg)
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la"}'

# Shell operators (should be rejected)
curl -X POST http://localhost:5675/execute-ffmpeg \
  -H "Content-Type: application/json" \
  -d '{"command": "ffmpeg -i input.mp4 > output.mp4"}'
```

### Adding New Features

When adding new features:

1. **Read Existing Code** - Understand patterns in [src/execute-ffmpeg.ts](src/execute-ffmpeg.ts) and [src/lib/ffmpeg-utils.ts](src/lib/ffmpeg-utils.ts)
2. **Follow Conventions** - Match existing error handling, validation, and response formats
3. **Add Validation** - Use Zod for request validation
4. **Handle Errors** - Categorize errors appropriately (validation, timeout, execution, etc.)
5. **Update Types** - Add TypeScript interfaces/types as needed
6. **Test Thoroughly** - Test both success and error cases

### Common Tasks

**Add a new endpoint:**
1. Add route in [src/index.ts](src/index.ts)
2. Create handler function
3. Add Zod schema for request validation
4. Add response type interface
5. Test with curl

**Modify FFmpeg processing:**
1. Edit [src/execute-ffmpeg.ts](src/execute-ffmpeg.ts) for queue/execution logic
2. Edit [src/lib/ffmpeg-utils.ts](src/lib/ffmpeg-utils.ts) for file handling
3. Update types as needed
4. Test with various FFmpeg commands

**Change queue behavior:**
1. Modify queue configuration in [src/execute-ffmpeg.ts:38](src/execute-ffmpeg.ts#L38)
2. Update concurrency calculation
3. Test with concurrent requests

### Debugging

**VSCode Debug (F5):**
- Set breakpoints in `src/` files
- Press F5 to start debugging
- Server runs on configured port
- Debugger attaches automatically

**Console Logging:**
```typescript
// eslint-disable-next-line no-console
console.log("[Debug]:", yourVariable);
```

### Documentation

When adding features, update:
- This README.md
- [CLAUDE.md](CLAUDE.md) (for AI assistant context)
- JSDoc comments in code
- API examples if endpoints change

## TypeScript Configuration

This project follows [Total TypeScript best practices](https://www.totaltypescript.com/tsconfig-cheat-sheet):

- ✅ `strict` mode enabled
- ✅ `noUncheckedIndexedAccess` for safer array/object access
- ✅ `noImplicitOverride` for explicit overrides
- ✅ `verbatimModuleSyntax` for explicit type imports
- ✅ `isolatedModules` for better tooling compatibility
- ✅ ES Modules (`"type": "module"`)
- ✅ `NodeNext` module resolution

## Git Hooks

### Pre-commit
- Runs ESLint on all files
- Runs Gitleaks on staged files to detect secrets
- Fails if linting errors or secrets detected

### Pre-push
- Runs full build (`pnpm build`)
- Fails if TypeScript compilation fails

## Docker

### Build Image Locally

```bash
docker build -t ffmpeg-server:latest .
```

### Run Container

```bash
docker run -p 5675:5675 \
  -e PORT=5675 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_SERVICE_ROLE_KEY=your_key \
  -e SUPABASE_BUCKET=ffmpeg-outputs \
  ffmpeg-server:latest
```

### Release Process

Docker images are automatically built and published via GitHub Actions:

1. **Create a Git Tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Create a GitHub Release:**
   - Go to GitHub → Releases → "Draft a new release"
   - Select the tag you just created
   - Add release notes
   - Click "Publish release"

3. **Automatic Build:**
   - GitHub Actions automatically builds multi-platform images
   - Publishes to Docker Hub as `udaian/ffmpeg-server`
   - Tags: `latest`, `1`, `1.0`, `1.0.0`

## VSCode Integration

This project includes VSCode configuration for:

- **Format on Save** with Prettier
- **ESLint auto-fix** on save
- **Debug Configuration** (F5 to start debugging)
- **Recommended Extensions** for TypeScript development

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5675` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment (development/production) |
| `SUPABASE_URL` | Yes | - | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | - | Service role key for storage operations |
| `SUPABASE_BUCKET` | No | `ffmpeg-outputs` | Storage bucket name |
| `ANTHROPIC_API_KEY` | Yes* | - | Anthropic API key for `/execute-llmpeg` endpoint |

\* Required only if using the `/execute-llmpeg` endpoint

## Roadmap

Completed features:
- [x] Support for input file URLs (download before processing)
- [x] Natural language FFmpeg command generation

Potential future enhancements:

- [ ] Webhook support for async job notifications
- [ ] Job status polling endpoint
- [ ] Custom timeout configuration per request
- [ ] Rate limiting and authentication
- [ ] Progress tracking for long-running operations
- [ ] Support for multiple storage backends (S3, GCS, etc.)
- [ ] FFmpeg preset templates
- [ ] Streaming support for real-time processing

## Troubleshooting

### Common Issues

**Issue: `EADDRINUSE` - Port already in use**
```bash
# Change the port in .env
PORT=5676
```

**Issue: Supabase upload fails**
- Verify environment variables are correct
- Check bucket exists and is public
- Verify service role key has storage permissions

**Issue: FFmpeg not found (local development)**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Verify installation
ffmpeg -version
```

**Issue: Pre-commit hook fails on Gitleaks**
```bash
# Install Gitleaks
brew install gitleaks  # macOS

# Or skip the hook temporarily (not recommended)
git commit --no-verify
```

## Performance Tuning

### Adjusting Concurrency

Edit [src/execute-ffmpeg.ts:38](src/execute-ffmpeg.ts#L38) to change the concurrency formula:

```typescript
// Current: min(max(floor(cpuCount / 2), 2), 8)
const maxConcurrent = Math.min(Math.max(Math.floor(cpuCount / 2), 2), 8);

// More aggressive (use all CPUs):
const maxConcurrent = cpuCount;

// More conservative (quarter of CPUs):
const maxConcurrent = Math.max(Math.floor(cpuCount / 4), 1);
```

### Adjusting Timeout

Edit [src/execute-ffmpeg.ts:115](src/execute-ffmpeg.ts#L115) to change the default timeout:

```typescript
// Current: 5 minutes
const runFFmpeg = async (
  argsString: string,
  timeoutMs: number = 5 * 60 * 1000  // Change this value
): Promise<ExecuteFfmpegResponse> => {
```

## Security Considerations

This server is designed for **controlled environments**. Before deploying to production:

1. **Add Authentication** - Implement API key or OAuth authentication
2. **Add Rate Limiting** - Prevent abuse with rate limiting middleware
3. **Restrict Commands** - Consider whitelisting specific FFmpeg operations
4. **Network Isolation** - Run in isolated network environment
5. **Resource Limits** - Use Docker resource limits in production
6. **Monitoring** - Add logging and monitoring for security events
7. **Input Validation** - Never expose directly to untrusted users

## License

MIT License - See LICENSE file for details

## Support

- **Issues**: https://github.com/udaian/ffmpeg-server/issues
- **Discussions**: https://github.com/udaian/ffmpeg-server/discussions
- **Docker Hub**: https://hub.docker.com/r/udaian/ffmpeg-server

## Acknowledgments

Built with:
- [Express](https://expressjs.com/) - Web framework
- [FFmpeg](https://ffmpeg.org/) - Media processing
- [Supabase](https://supabase.com/) - Storage backend
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Zod](https://zod.dev/) - Schema validation
- [p-queue](https://github.com/sindresorhus/p-queue) - Queue management
