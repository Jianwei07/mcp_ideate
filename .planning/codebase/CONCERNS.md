# Concerns

## Runtime Cutover

Files: `backend/`, `frontend/`

Impact: stale Python references can mislead future backend work.

Fix approach: keep backend work under the Bun workspace and remove Python runtime
references from docs and planning.

## Misleading Transcript

Files: `backend/client/src/host/server.ts`, `frontend/src/App.tsx`

Impact: application-authored labels appear beside protocol callbacks without
origin metadata, so the UI can imply that every row is an MCP event.

Fix approach: record channel, origin, direction, method, and correlation at the
event boundary and render those facts.

## Lost Error Cause

File: `backend/client/src/host/server.ts`

Impact: unknown errors collapse to a generic message and the audit stores only
`RuntimeError`, preventing diagnosis.

Fix approach: classify errors at adapters, persist safe codes, and print full
cause chains to stderr.

## Ephemeral Runs

File: `backend/client/src/host/server.ts`

Impact: browser refresh or process restart loses conversation history.

Fix approach: persist safe session, turn, event, citation, and usage metadata.

## Course Feature Deprecation

Files: `backend/server/src/`, `backend/client/src/mcp/connection.ts`

Impact: roots, sampling, and MCP logging are being deprecated after the pinned
course revision.

Fix approach: isolate these features behind the MCP connection and RunEngine,
label them in the UI, and avoid coupling future AI Ops agents to them.
