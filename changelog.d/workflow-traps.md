---
internal: How the repository is checked on a developer's machine; nothing a project can use or see changes.
commits:
  - fix(editor-checks): a check file that does not load fails itself, not the whole run
  - fix(tools): generated files check out as LF, so a build or gate run leaves none modified
  - fix(tools): tool-spawn reads the project's scripts, not what is installed beside them
  - feat(tools): run-gates says when the install is not the lockfile's, and a gate parses every editor check
---
