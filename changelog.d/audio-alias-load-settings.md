---
section: Fixed
commits:
  - fix(audio): preserve clip load settings across source aliases
---
**Clips that share a packaged audio file keep their own load mode and trim.** A streamed music track and a decoded effect can now use the same file in either load order. References with matching settings still share one buffer.
