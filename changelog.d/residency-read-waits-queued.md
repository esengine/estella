---
internal: The wait a verification launcher makes before it reads a streamed world; nothing a project can call, draw or author changes.
commits:
  - fix(tools): a residency read waits for a cell that is readied and wanted, not only for one loading - a cell's preparation finishes in a frame's turns now, so between prepared and publishing it is queued; with the clock handed over nothing stepped it and the read after a source came back saw the place still absent
---
