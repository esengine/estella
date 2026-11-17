---
section: Changed
commits:
  - perf(render): a batch draw finds its shader variant by index, not by building a key - every retained text batch, lit sprite, alpha-clipped mask and lit tile layer asked for its program with a fresh list of feature names, which was copied, sorted, joined into a string and hashed every frame
  - perf(render): a nine-slice or tiled sprite is one draw command, not one per cell - every cell built its own command (sort key, clip state, a sort entry, a merge test) only to be merged back with its neighbours, nine for a UI panel and up to 16384 for a tiled floor
  - perf(ecs): reading an engine component no longer builds its list-field names each time - every world.get and tryGet of a builtin spread the component's number-list and entity fields into a new array before reading the result; the list is made once per component
---
**Nine-slice panels, tiled sprites, text and lit sprites cost less to draw each frame.** A nine-slice image or a tiled sprite is now one draw command instead of one per cell (nine for a panel, up to 16384 for a tiled floor), text and lit or masked sprites find their shader without building a string key every frame, and reading an engine component from a script allocates one array fewer. What is drawn does not change.
