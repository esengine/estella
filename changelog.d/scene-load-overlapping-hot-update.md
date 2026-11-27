---
section: Fixed
commits:
  - fix(runtime): retry scene loads superseded by a manifest update
---
**Scene loads follow the active asset manifest during hot updates.** When a hot update changes the manifest while a scene is being read, the load retries with the current assets before bringing the scene into the game.
