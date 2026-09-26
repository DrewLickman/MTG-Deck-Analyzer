# Blockers

## 2026-09-07 — Card-text verification (resolved)
- Task/layer: Read-only Scryfall Oracle text retrieval for the Merieke deck review.
- Evidence: The sandbox initially denied socket access; the first approved request then returned HTTP 400 for missing User-Agent and Accept headers.
- Resolution: Approved read-only requests with both required headers succeeded. Current card text informed the review in `deck-reviews/2026-09-06-merieke-spy-kit.md`.
- Retry condition: Resolved; use required API headers for later Scryfall requests. No analysis remains blocked.
