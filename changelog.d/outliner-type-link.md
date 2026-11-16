---
section: Changed
commits:
  - feat(editor): the Outliner's Type names a prefab instance's prefab as a link that opens it, as Unreal's does - a root instance reads "Edit <prefab>" and opens it in Prefab Mode; while playing it names the prefab and says to stop first, since Prefab Mode swaps the document Stop writes kept changes into; a missing prefab says so; a member of an instance reads its own kind; the Type column shows by default and is wide enough for a name
---
**The Outliner's Type column opens a prefab, as Unreal's opens a Blueprint.** A prefab instance's row now reads "Edit Enemy" (its prefab's name) instead of "Prefab", and clicking it opens that prefab in Prefab Mode. While the game runs the row names the prefab and says to stop first; a prefab whose file is gone says so. The Type column is now shown by default.
