---
section: Changed
commits:
  - perf(editor): load live material textures concurrently
---
**Material previews update sooner when several texture maps need loading.** The editor loads independent maps together and still applies the remaining material edits if one map fails.
