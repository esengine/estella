---
section: Removed
commits:
  - refactor(examples): the space frigate is no longer a submodule of the engine repository
  - refactor(editor): the template gallery no longer names the space frigate, which leaves the engine repository
---
**The Space Frigate example is no longer part of the engine repository.** It was mounted at `examples/space-frigate` as a submodule; it is now only its own repository, [esengine/estella-space-frigate](https://github.com/esengine/estella-space-frigate), and no longer appears in the editor's example gallery. A clone of the engine no longer fetches it.
