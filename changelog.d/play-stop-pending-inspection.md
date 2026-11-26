---
section: Fixed
commits:
  - fix(editor): retire Play inspection requests with their session
---
**Stopping Play releases pending inspection reads.** Unanswered requests settle when the preview stops, reloads, or exits. An offer to keep edits only writes to the scene it came from.
