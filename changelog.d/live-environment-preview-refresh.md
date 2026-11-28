---
section: Fixed
commits:
  - fix(editor): refresh environment previews when their source files change
---
**Lighting previews refresh when the environment document or its sky image changes.** The panel also retries when a missing sky is restored and skips redraws for unrelated asset saves.
