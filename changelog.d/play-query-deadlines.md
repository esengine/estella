---
section: Changed
commits:
  - perf(editor): release Play query deadlines when requests settle
---
**Play monitoring releases its timers when queries finish.** Camera, statistics, streaming and other queries free their deadline on reply or cancellation.
