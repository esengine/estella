---
section: Changed
commits:
  - perf(bake): a probe grid is written as a binary .esprobes of half floats, a fifth the size of its JSON, and the loader checks the version it reads - version 1 grids still load
  - feat(editor): Bake Lighting writes a probe grid as a version 2 binary .esprobes - half floats, a fifth the size of the JSON it wrote, through the one writer the CLI uses; the bake check reads it back with the SDK's decoder
---
**A baked probe grid is a binary file a fifth the size it was, and loading one checks its version.** Bake Lighting and `bake-scene` now write `.esprobes` version 2: a small header and the coefficients as half floats, the precision the GPU keeps them in anyway, so the Bistro's grid is 19 KB where its JSON was 92 KB. Grids baked before this are version 1 JSON and load as they did; a file of a version this build does not know is refused with its version named, where before its `version` field was never read. `encodeProbeFile` and `decodeProbeFile` read and write the format for tools of your own.
