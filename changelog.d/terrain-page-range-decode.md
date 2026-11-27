---
section: Fixed
commits:
  - fix(terrain): decode render pages with their own height range
---
**Cached terrain no longer jumps when a nearby edit extends the height range.** Built-in terrain rendering and virtual texture baking decode each page with the range it was built with, so old and new pages can stay visible together during a rebuild.
