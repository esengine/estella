---
section: Fixed
commits:
  - fix(runtime): retain project registrations across packaged game starts
---
**A mini-game can start again with all its gameplay scripts.** Each game installs the project's plugins and systems, including after a failed first start. The package evaluates the project module once.
