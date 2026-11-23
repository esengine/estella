---
section: Fixed
commits:
  - fix(editor): release failed viewport and play sessions
  - fix(runtime): release games and report errors when startup fails
---
**A failed game start releases its input, scene and rendering resources.** The editor viewport and Play can retry after a failed start. Web builds and single-file playables now leave the loading screen and report the cause when the engine download or compilation fails. Model-baking workers stop with their game.
