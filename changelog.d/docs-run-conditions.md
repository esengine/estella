---
section: Changed
commits:
  - "docs: document run conditions, profileDomain and touches on plugins"
---
**The manual now covers run conditions, profiler domains and declared access for plugins.** Systems has a Run conditions section: `playModeOnly`, `isPlayMode` and `isEditor` / `isRuntime`, why the engine's simulation plugins stop in the editor's edit mode while project scripts need no gate, and how `runIf`, `activeWhen` and `runWhenPaused` each skip a system. `profileDomain` is listed for systems and plugins, the profiler page explains how its cost tree groups systems into domains, and the plugin page points a system that takes `GetWorld()` to `touches`. In English and Chinese.
