# PR Review Rules

Rules for LLM-based code review.

## Context

- We are a fast-moving startup. Prefer simple solutions for normal use over
  complexity for unlikely cases or hypothetical scale.
- Flag concrete bugs, data loss, security problems, leaked secrets, and broken
  public contracts.
- Do not request unrelated cleanup, speculative flexibility, or compatibility
  work without a concrete need.

## Review Boundary

- Review only problems introduced or made worse by the change, and comment on
  the relevant lines.
- Inspect the diff and surrounding code using read-only tools. Do not run builds,
  tests, lint, formatters, servers, or project scripts. CI owns validation.

## Severity

- **blocker** — Must fix before merge
- **warning** — Should fix, but does not block the merge
- **nit** — Optional improvement

## Principles

- Prefer clear, boring code and keep behavior close to the feature that owns it.
- Add abstractions or shared code only for real reuse or a clear domain boundary.
- Validate untrusted input, keep secrets private, and avoid unsafe process or file access.
- Preserve API behavior unless a breaking change is intentional.
- Let unexpected route errors reach global error handling. Catch locally only for known failures, and log failures that do not propagate.
- Validate required environment variables clearly before use.
- Keep resource use bounded and clean up after success, failure, and cancellation.
- Preserve TypeScript strictness, put main exports first, and do not introduce classes.
- Update relevant docs when endpoints, environment variables, or deployment behavior change.
- Avoid dead code, unrelated refactors, and unnecessary dependencies.

## AI Agent Instructions

When agent instructions change, check that they are clear, consistent, correctly
scoped, and match the agent's actual capabilities.
