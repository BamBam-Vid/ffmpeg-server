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
- **Anthropic API**: Required for `/execute-llmpeg` endpoint:
  - `ANTHROPIC_API_KEY` - Anthropic API key for Claude Sonnet 4

### Express Server Structure

- Server entry point: `src/index.ts`
- Middleware: CORS enabled, JSON body parsing, request ID generation
- Current endpoints:
  - `GET /health` - Health check with timestamp and FFmpeg version verification
  - `POST /execute-ffmpeg` - Execute FFmpeg commands with queue management
    - Request body: `{ "command": "ffmpeg -i input.mp4 output.mp4" }`
    - Command MUST start with `ffmpeg ` (validation enforced by Zod)
    - Input files can be HTTP/HTTPS URLs (automatically downloaded)
    - Returns: `{ success: true, stdout, stderr, exitCode, outputs: [{ filename, path, url, size, contentType }] }`
  - `POST /execute-llmpeg` - Natural language FFmpeg command generation and execution
    - Request body: `{ "task": "concatenate videos", "inputs": [{ "name": "video1", "url": "https://..." }, ...] }`
    - Uses Claude Sonnet 4 to convert natural language to FFmpeg commands
    - Automatically downloads input files and executes generated command
    - Returns: Same format as `/execute-ffmpeg`

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
- **Request-scoped workspaces**:
  - Each request gets isolated temp directory: `/tmp/{requestId}/inputs` and `/tmp/{requestId}/outputs`
  - Uses `crypto.randomUUID()` for request IDs (stored in `res.locals.requestId`)
  - Automatic cleanup in finally block ensures resources are freed
  - Prevents filename collisions between concurrent requests
- **Input file downloading**:
  - HTTP/HTTPS URLs in FFmpeg commands are automatically detected and downloaded
  - Global download queue limits concurrent downloads to 12 across all requests
  - Downloads to request-scoped inputs directory
  - URL replacement: URLs in commands replaced with local file paths
  - Prevents network I/O overhead and FFmpeg buffer issues with many URLs
- **Output file handling**:
  - Automatically detects output files from FFmpeg arguments
  - Parses arguments to identify flags that require values (prevents false positives)
  - Replaces output paths with absolute paths in request outputs directory
  - Supports multiple output files per command
- **Supabase Storage integration**:
  - Automatically uploads all generated output files to Supabase Storage
  - Storage path format: `{timestamp}-{filename}`
  - File size limit: 100MB per file
  - Automatic MIME type detection using `mime-types` package
  - Returns public URLs in response with metadata (size, contentType)
  - Atomic operation: all uploads succeed or entire operation fails
  - Always cleans up temporary files after upload (success or failure)

### Natural Language Processing (LLMpeg)

- **Claude API integration**:
  - Uses Claude Sonnet 4 (`claude-sonnet-4-20250514`) for command generation
  - Converts natural language tasks to FFmpeg commands
  - Prompt engineering: Instructs Claude to generate only FFmpeg arguments (no `ffmpeg` prefix)
  - Response format: JSON with `command` and `reasoning` fields
  - Handles markdown-wrapped JSON (```json...```) and plain JSON responses
  - Error handling for Anthropic API failures
- **Workflow**:
  1. Download input files from URLs
  2. Build context-aware prompt with task + input file paths
  3. Call Claude API to generate FFmpeg command
  4. Execute generated command using shared FFmpeg queue
  5. Upload outputs to Supabase Storage
  6. Return results to user

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

## Code Style

### File Organization

For any file, organize code in this order to make the most important information appear first:

1. **Main export(s)** - Primary function/class/component at the top
2. **Supporting code** - Helper functions and type definitions in the order they're used in the main export

This progressive disclosure pattern makes files easier to scan - the most important code appears first, with supporting details revealed as you read down.

**Example:**

```typescript
// Main export first
export const createScript = async (params: CreateScriptParams) => {
  const result = helperFunction(params);
  // Implementation using helper functions and types
};

// Helper functions and types in order of use
const helperFunction = (params: CreateScriptParams) => { /* ... */ };

export interface CreateScriptParams {
  provider: "openai" | "gemini";
  messages: ScriptMessage[];
}

export type ScriptMessage = /* ... */;
export type UserMessageContent = /* ... */;
```
