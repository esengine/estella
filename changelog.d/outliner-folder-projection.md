---
section: Changed
commits:
  - perf(editor): group Outliner folder work by path
  - perf(project): ship faster Outliner folder projection
---
**Large scenes with shared folders respond faster in the Outliner.** The editor groups matching scene roots by folder before counting them, reducing the work needed to refresh collapsed folder rows or update search results.
