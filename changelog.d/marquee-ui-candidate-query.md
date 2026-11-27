---
section: Changed
commits:
  - perf(editor): query UI candidates separately for marquee selection
---
**World marquee selection does less work in scenes with sparse UI.** The editor queries UI nodes directly and combines hits in scene order when the marquee also selects UI.
