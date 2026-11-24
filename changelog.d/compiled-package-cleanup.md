---
section: Fixed
commits:
  - fix(export): stage only the compiled modules selected by each package
---
**Rebuilding into an existing folder removes obsolete compiled system modules.** Web, minigame and native exports now keep the modules selected by the current build and preserve custom files in the package’s `aot` folder.
