---
section: Changed
commits:
  - perf(ui): reuse screen membership across stable layout passes
---
**Large screen-space UI trees cost less CPU time to check for layout changes.** Estella reuses the screen membership set when the same entities remain under the Canvas roots. Sprites and other entities without a layout component still switch between screen and world rendering when reparented.
