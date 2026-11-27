---
section: Fixed
commits:
  - fix(world): wait for far proxy render programs before handoff
---
**A visible cell stays in place while its far proxy waits for render programs.** Proxies release prepared assets when the source leaves range, and a failed proxy can retry when the source returns.
