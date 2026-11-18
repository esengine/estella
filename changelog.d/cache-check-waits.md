---
internal: A CI check's timing; the engine, the editor and every package are unchanged.
commits:
  - fix(ci): the cache check waits for the game after its offline restart - a launch opens on the engine's ident, and the check judged the frame half a second in, so it saw the ident and reported the cached version lost; it now waits for the game's colour as the update steps above it do
---
