# Repository Instructions

HTTP server that runs FFmpeg commands. `POST /stream-ffmpeg` (code in `src/stream-ffmpeg/`) uploads outputs to the caller's S3-compatible storage; the older `/execute-ffmpeg` and `/execute-ffprobe` still use Supabase. The caller contract is `docs/stream-ffmpeg-api.md` and the design is `docs/stream-ffmpeg-plan.md`.

## Engineering Philosophy

- We are a fast-moving startup; optimize for doing less, but doing it well.
- Keep solutions simple and minimal until real requirements prove more is needed.
- Add abstractions, fields, services, or shared plumbing only when repetition or a concrete product need justifies them.
- Preserve correctness and data integrity in the small set of things we choose to build.
- Prefer clear, boring, maintainable implementation over premature flexibility.

## Code Ordering

- Put the main export first in a file.
- Define helper functions and constants after the main export.
- Order helpers by first use / call flow.

## Abstractions

- Do not create needless abstractions.
- Prefer inlining single-use logic unless the abstraction is reused or creates a clear domain boundary.
- Never create helpers for single-use logic.
- Write inline code first, infer application patterns from real repetition, then propose abstractions to the user instead of creating them yourself.
- Keep things simple.
- Optimize for readable code.

## Colocation

- Prefer colocating code with its usage.
- Place code as close as practical to the feature, route, or module that uses it.

## Classes

- Never use JavaScript or TypeScript classes.

## Environment Variables

- Required server env vars must be read into top-level constants and validated immediately at startup.
- Throw a clear error for each missing required env var before constructing clients or starting request handling.
- Do not use non-null assertions, silent defaults, generic env helpers, or wrapper functions for one-off required env validation.
- Keep env validation close to the module that uses the value.

## Server Error Handling

- Do not wrap route handlers in generic `try/catch` blocks for error formatting.
- Let unexpected route errors propagate to global error middleware.
- Catch locally only when translating a known expected failure into a specific HTTP status.

## Server Error Logging

- Server-side failures must be visible in server logs.
- Global error middleware only logs errors that reach Express.
- Event callbacks, background jobs, and locally handled `catch` blocks must log their own failures before returning.
- If a local `catch` writes a response, returns fallback data, or otherwise does not rethrow, log the error in that block with enough request or job context to debug it.
- Do not silently swallow meaningful async errors with `.catch(() => undefined)`. Log and continue unless the failure is truly harmless best-effort cleanup.

## Tooling

- Use pnpm only, never npm or yarn. The pnpm version is pinned in `package.json` and the Node version in `.nvmrc`.
- Check changes with `pnpm build`, which runs lint and TypeScript.
- In the Docker production stage, install with `pnpm install --prod --frozen-lockfile --ignore-scripts` so the Husky `prepare` script (a dev dependency) does not run.

## Docs

- Keep docs minimal and complete: explain only what someone needs to get started and succeed, skip implementation details unless usage needs them, and prefer short copy-paste-ready commands with clear required inputs.
- `README.md` must cover how to use the server (quick start, endpoint usage), how to deploy it (Docker steps, required config), and how to contribute (setup, lint/build checks, PR expectations).
- `DOCKER_HUB_OVERVIEW.md` must cover how to deploy (`docker run` examples, env vars labeled Required or Optional with defaults) and how the FFmpeg endpoint works (request shape, command rules, response shape including outputs).
- Update both files, and `docs/stream-ffmpeg-api.md` for `/stream-ffmpeg`, whenever endpoints or env vars change.

## Git / Review

- Never commit or push changes before the user has reviewed them.
- Never commit or push unless the user explicitly asks for that action in the current turn.
- If a PR request would require creating a commit or pushing local changes, stop and ask the user first.
