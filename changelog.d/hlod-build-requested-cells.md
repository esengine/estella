---
section: Changed
commits:
  - perf(world): build requested far proxies without scanning the entire world
  - perf(editor): build selected HLOD proxies directly
---
**Generating an HLOD proxy skips unrelated cells during proxy assembly.** The editor uses the same mesh assembly as export and asks it to build the selected cells directly.
