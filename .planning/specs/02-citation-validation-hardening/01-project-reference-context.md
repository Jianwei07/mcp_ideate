# 01 Project Reference Context

## Context

- `.planning/PROJECT.md` currently has canonical MCP/security links under `## Docs`.
- `.planning/current/DECISIONS.md` records durable architectural decisions.

## Action

- Keep `## Docs` in `.planning/PROJECT.md`.
- Add one-line purpose annotations for each MCP/security reference link.
- Record the durable decision that citation validation stays strict and fail-closed.
- Do not store raw run transcript, protected evidence, prompts, model output, raw protocol payloads, stack traces, or reasoning tokens.

## Verify

- `.planning/PROJECT.md` docs links have local explanations.
- `.planning/current/DECISIONS.md` includes strict fail-closed citation validation.

## Done

- Future planning agents can infer why each reference exists without fetching links first.
