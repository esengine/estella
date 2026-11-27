---
section: Fixed
commits:
  - fix(assets): resolve suffixed texture paths in Play and web builds
  - fix(editor): use indexed settings for suffixed asset references
---
**Local texture references with query or fragment suffixes keep their import settings in the editor and Play.** Web builds also resolve those references to the packaged file. Exact registered filenames take precedence over suffix handling.
