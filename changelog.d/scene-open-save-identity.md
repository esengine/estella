---
section: Fixed
commits:
  - fix(editor): bind queued saves to the open document
  - fix(project): ship safe scene open and save ordering
---
**A queued save cannot write a scene that opened after the request.** Save and Save As stop if another document replaces their source. If opening a scene fails, the existing document keeps its original save and recovery path.
