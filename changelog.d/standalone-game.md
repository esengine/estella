---
section: Added
commits:
  - feat(editor): Standalone Game runs Play in a process of its own, multiplayer included
---
**Play can run the game in a process of its own (Standalone Game), multiplayer included.** Pick Standalone in the Play target menu and the game opens in its own window and process, as Unreal's Standalone Game does: a game that crashes or hangs its main thread no longer takes the editor with it. A multiplayer preview runs one process per player, connected through the editor. Inspect, logs and Stop work as they do in the viewport. It does not make a GPU-heavy game cheaper for the editor: both still share one graphics card.
