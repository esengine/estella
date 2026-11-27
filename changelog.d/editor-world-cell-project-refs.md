---
section: Fixed
commits:
  - fix(editor): validate streamed cells against project component schemas
---
**World editing checks entity references declared by project components.** A scene with an invalid cross-cell reference opens whole so it can be repaired, and refreshed component schemas invalidate cached cell plans.
