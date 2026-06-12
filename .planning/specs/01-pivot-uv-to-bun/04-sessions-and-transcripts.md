# 04 Sessions And Transcripts

Implement Drizzle-backed sessions, standalone turns, safe events, citations,
SSE replay, volatile details, metadata-only JSONL audit, interrupted-run
recovery, and sanitized error contracts.

Verification: `cd backend && bun test client/tests`.

Done when session history survives restart and protected payloads are absent
from SQLite and JSONL.

Rollback: delete the local development database and rerun migrations.
