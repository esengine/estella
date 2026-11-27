---
section: Changed
commits:
  - perf(editor): skip hull construction for fully enclosed marquee hits
---
**Marquee selection is faster when it encloses many entities.** The editor accepts fully enclosed projections without building their outlines and still checks the exact outline where it crosses the marquee.
