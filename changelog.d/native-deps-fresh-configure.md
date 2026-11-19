---
internal: How the engine's own build configures SDL and Dawn on a build machine; nothing a project can call, draw or author changes.
commits:
  - fix(build): SDL and Dawn are configured fresh - their build directories are cached between runs and a CMakeCache names its compiler by full path, so when a build machine's MSVC toolset moved the configure failed on a cl.exe that was gone
---
