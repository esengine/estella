---
section: Fixed
commits:
  - fix(pipeline): isolate compiled artifacts across concurrent exports
---
**Simultaneous exports of one project keep their own compiled systems.** Web, minigame and native packages can finish copying their modules while another export builds different systems or targets. A failed link preserves the last successful build. Repeated Windows exports with MinGW can reuse the same DLL bytes.
