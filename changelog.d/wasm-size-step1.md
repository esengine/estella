---
section: Changed
commits:
  - perf(wasm): stop exporting yoga's C entry points from the engine module
  - perf(wasm): keep the editor reflection bindings out of the SDK engine
---
**The web and mini-game engine binaries are smaller: yoga's C entry points and the editor reflection bindings no longer ship in them.** The engine module exported 190 yoga C functions that nothing called, and carried the string-dispatched `editor_*` component accessors with their property metadata, which no host, export or the editor calls. Both are gone from the shipped engine; a project embedding the engine that wants the `editor_*` bindings configures with `-DES_ENABLE_EDITOR_API=ON`.
