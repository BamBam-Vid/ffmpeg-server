# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Express.js server built with TypeScript for ffmpeg processing. It uses modern tooling and follows strict TypeScript best practices from Total TypeScript guidelines.

## Commands

### Development
- `pnpm dev` - Start development server with hot reload (nodemon + tsx)
- `pnpm build` - Lint and compile TypeScript to JavaScript (output: `dist/`)
- `pnpm start` - Run production build from `dist/index.js`
- `pnpm lint` - Run ESLint

### Setup
```bash
nvm use                              # Switch to Node v24.11.1
corepack enable
corepack prepare pnpm@10.1.0 --activate
pnpm install
cp .env.example .env                 # Create environment file
```

### Docker
```bash
docker build -t ffmpeg-server:latest .
docker run -p 5675:5675 -e PORT=5675 ffmpeg-server:latest
```

### CI/CD
```bash
# Create and push a git tag to trigger Docker image build
git tag v1.0.0
git push origin v1.0.0

# Then create a GitHub Release from the tag (required for deployment)
# Go to GitHub → Releases → Draft new release → Select tag → Publish
```

## Architecture

### Module System
- **ES Modules only** (`"type": "module"` in package.json)
- Use `import/export` syntax, not `require()`
- TypeScript config uses `NodeNext` module resolution

### TypeScript Configuration
Following Total TypeScript best practices:
- **Strict mode**: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- **Explicit imports**: `verbatimModuleSyntax` requires `import type` for type-only imports
- **No implicit any**: All types must be explicit or inferred
- **Source**: `src/` → **Output**: `dist/`

### Code Quality Rules
ESLint enforces:
- `no-console: error` - Use `// eslint-disable-next-line no-console` only for intentional logging
- Unused variables must be prefixed with `_` (e.g., `_req`, `_unused`)
- `prefer-const` for immutable bindings
- No debugger statements

### Git Hooks (Husky)
**Pre-commit** (`.husky/pre-commit`):
- Runs `pnpm lint` on all files
- Runs Gitleaks on staged files (install: `brew install gitleaks`)
- Will warn if Gitleaks not installed but won't fail

**Pre-push** (`.husky/pre-push`):
- Runs `pnpm build` to ensure TypeScript compiles
- Fails if linting or compilation fails

### Environment Configuration
- Default port: `5675` (configurable via `PORT` env var)
- Environment variables loaded via `dotenv` from `.env` file
- `.env` files are gitignored
- **Supabase Storage**: Required env vars:
  - `SUPABASE_URL` - Supabase project URL
  - `SUPABASE_SERVICE_ROLE_KEY` - Service role key for server-side operations
  - `SUPABASE_BUCKET` - Storage bucket name for FFmpeg outputs (default: `ffmpeg-outputs`)

### Express Server Structure
- Server entry point: `src/index.ts`
- Middleware: CORS enabled, JSON body parsing
- Current endpoints:
  - `GET /` - Root endpoint
  - `GET /health` - Health check with timestamp and FFmpeg version verification
  - `POST /execute-ffmpeg` - Execute FFmpeg commands with queue management
    - Request body: `{ "command": "ffmpeg -i input.mp4 output.mp4" }`
    - Command MUST start with `ffmpeg ` (validation enforced by Zod)
    - Returns: `{ success: true, stdout, stderr, exitCode, outputs: [{ filename, path, url, size, contentType }] }`

### FFmpeg Processing Architecture
- **Queue-based execution** using `p-queue` to limit concurrent FFmpeg processes
- **Concurrency limit**: Dynamically calculated as `Math.min(Math.max(Math.floor(cpuCount / 2), 2), 8)`
- **Timeout protection**: Default 5-minute timeout per FFmpeg process
- **Command validation**: Requires full FFmpeg command starting with `ffmpeg ` (e.g., `ffmpeg -i input.mp4 output.mp4`)
- **Argument parsing**: Uses `shell-quote` library to safely parse command arguments after stripping `ffmpeg ` prefix
- **Security**: Rejects shell operators (`>`, `|`, `&&`, etc.) in FFmpeg arguments
- **Validation**: Uses Zod for request body validation with `.refine()` to ensure command starts with `ffmpeg `
- **Error categorization**: Distinguishes between validation, timeout, spawn, execution, parse, and storage errors
- **Process management**: Uses `child_process.spawn()` for FFmpeg execution with stdout/stderr capture
- **Output file handling**:
  - Automatically detects output files from FFmpeg arguments
  - Creates temporary directory for outputs in `os.tmpdir()/ffmpeg-outputs/`
  - Replaces output paths with absolute temp paths during execution
  - Supports multiple output files per command
- **Supabase Storage integration**:
  - Automatically uploads all generated output files to Supabase Storage
  - Storage path format: `{timestamp}-{filename}`
  - File size limit: 100MB per file
  - Automatic MIME type detection from file extensions
  - Returns public URLs in response with metadata (size, contentType)
  - Atomic operation: all uploads succeed or entire operation fails
  - Always cleans up temporary files after upload (success or failure)

## Development Workflow

1. All source code goes in `src/`
2. TypeScript compiles to `dist/` (gitignored)
3. VSCode debug config available (F5 to debug)
4. Format on save with Prettier (VSCode integration)
5. ESLint auto-fix on save

## GitHub Actions Workflows

### Build Workflow
- **File**: `.github/workflows/build.yml`
- **Triggers**: Push/PR to main branch
- **Steps**: Install dependencies → Run `pnpm build` (lint + TypeScript compilation)

### Docker Release Workflow
- **File**: `.github/workflows/docker-release.yml`
- **Triggers**: GitHub Releases only (NOT tag pushes)
- **Builds**: Multi-platform images (linux/amd64, linux/arm64)
- **Pushes to**: Docker Hub as `udaian/ffmpeg-server`
- **Tags**: Auto-generates semantic versions (`1.0.0`, `1.0`, `1`, `latest`)
- **Requirements**:
  - GitHub secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`
  - Must create a GitHub Release (tagging alone won't trigger workflow)

## Important Notes

- **Package manager**: pnpm 10.1.0 (pinned) - do not use npm or yarn
- **Node version**: v24.11.1 (pinned in `.nvmrc` and Docker)
- **No console.log**: Use explicit eslint-disable comment when logging is needed
- **Type safety**: Leverage `noUncheckedIndexedAccess` - array/object access may be undefined
- **Imports**: Use `import type` for type-only imports due to `verbatimModuleSyntax`
- **Docker production install**: Must use `pnpm install --prod --frozen-lockfile --ignore-scripts` to skip Husky prepare script (dev dependency)
