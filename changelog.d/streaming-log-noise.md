---
section: Fixed
commits:
  - fix(residency): a streamed world stops filling the console - the files the cook writes for it are no longer reported as missing from the package, physics not being installed is said once a game, and a cell's or far proxy's preload summary is a debug line
---
**A streamed world no longer fills the console while it streams.** Every cell document and far proxy the cook writes under
`world/` was reported as "not in this package" (1362 warnings in 30 seconds on a 144-cell town, for files that load fine), every
cell said again that physics was not installed, and every cell and far proxy printed its preload summary. The cook's world files
are no longer checked against the asset manifest, physics is mentioned once a game, and the per-cell preload line is a debug line
(the same numbers are in `worldResidencyReport(app).delivery`). On a phone-speed run the console went from hundreds of lines a
minute to one.
