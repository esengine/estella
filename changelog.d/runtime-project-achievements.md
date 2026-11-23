---
section: Fixed
commits:
  - fix(runtime): honor declared achievements in playables and minigames
---
**Single-file playables and minigames now enforce the project's achievement IDs.** A misspelled ID produces the same diagnostic as in editor Play and Web builds and stays out of the player's save. Projects with an empty or omitted achievement list can still use free-form IDs.
