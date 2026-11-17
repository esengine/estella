---
internal: render-submit-cost averages each system over many frames; nothing a project can call or draw changes.
commits:
  - chore(tools): render-submit-cost reports each system's and scope's mean over many frames - --avg N steps N frames one at a time and averages, since one frame's reading of a system that takes microseconds rounds to 0 or 0.1 ms
---
