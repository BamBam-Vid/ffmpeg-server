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

### Express Server Structure
- Server entry point: `src/index.ts`
- Middleware: CORS enabled, JSON body parsing
- Current endpoints:
  - `GET /` - Root endpoint
  - `GET /health` - Health check with timestamp

## Development Workflow

1. All source code goes in `src/`
2. TypeScript compiles to `dist/` (gitignored)
3. VSCode debug config available (F5 to debug)
4. Format on save with Prettier (VSCode integration)
5. ESLint auto-fix on save

## Important Notes

- **Package manager**: pnpm 10.1.0 (pinned) - do not use npm or yarn
- **Node version**: v24.11.1 (pinned in `.nvmrc` and Docker)
- **No console.log**: Use explicit eslint-disable comment when logging is needed
- **Type safety**: Leverage `noUncheckedIndexedAccess` - array/object access may be undefined
- **Imports**: Use `import type` for type-only imports due to `verbatimModuleSyntax`
