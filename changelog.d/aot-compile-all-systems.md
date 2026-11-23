---
section: Changed
commits:
  - feat(aot): release builds compile every system the compiler takes, not only those marked @compiled
  - feat(settings): Packaging has a Compile all systems row
---
**Release builds compile every system the compiler can take, without `@compiled`.** A system had to be
marked to run as machine code, so systems that compiled perfectly well still ran as scripts. Now a
release or shipping export compiles each one the compiler takes; the rest run as scripts as before, and
a system marked `@compiled` that cannot compile is still an error with its line. With no compiler on
the machine (emcc for web and mini-games, a C compiler for desktop) a project that marked nothing still
builds, and the export says how many systems ran as scripts for want of one. Project Settings →
Packaging → **Compile all systems** (`packaging.compileAllSystems`, on by default) turns it back to
marked systems only; `--no-aot` still compiles nothing.
