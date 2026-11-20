---
section: Fixed
commits:
  - fix(editor): the project watcher reports a file only when it changed, so opening a scene loads its assets once
  - fix(editor): opening a scene no longer loads every asset twice on Windows
---
**Opening a large scene no longer loads every asset twice.** On Windows the project watcher heard the editor's own reads while a scene opened: a watched folder reports itself when its access time moves, and a burst of those overflowed into a nameless event that the editor took as "every file changed". Every asset of the scene was then loaded a second time, with its textures missing in the meantime. Bistro's open went from about 11 seconds of loading to about 7. The watcher now reports a file only when its write time, metadata time or size changed. When the system does drop the file names, the watcher compares those stamps across the watched folders and reports only what really changed.
