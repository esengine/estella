---
section: Changed
commits:
  - perf(editor): resolve audio load choices during asset indexing
---
**The editor refreshes large project indexes faster after a file change.** It gathers audio load settings during the index rebuild, skipping a second classification pass over every asset.
