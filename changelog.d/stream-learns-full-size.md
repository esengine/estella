---
section: Fixed
commits:
  - fix(render): streaming no longer decodes a texture again and again at the size it already has - a texture that loaded as a placeholder, as a model baked at load does, kept the placeholder's size as its file's, so the streamer kept shrinking it to that size and the decode kept giving the full map back: a decode and an upload every quarter second for each such texture, and no memory saved; the loader learns a texture's full size from every decode that gives it, and the streamer reads each texture's sizes afresh on every pass instead of keeping what it saw first
---
**Texture streaming no longer decodes a model's baked maps over and over.** A texture that loads as a placeholder and is filled in later, as a model baked at load is, was taken to be the placeholder's size for good, so on the levels that stream (low and medium) the streamer shrank it and the decode handed back the full map, a few times a second for every such map, without freeing any memory. Each texture's full size is now what its decodes give, and streaming holds these maps at the size their views need.
