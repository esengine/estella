---
section: Fixed
commits:
  - fix(assets): enforce whole preload concurrency limits
---
**Asset preloads respect their concurrency limit and finish even with a `NaN` limit.** Explicit asset lists and scene dependencies use whole worker slots, round fractional limits down, and fall back to serial loading when the limit is `NaN`.
