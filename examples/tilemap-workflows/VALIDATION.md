# Tilemap workflow validation

Verified on Windows with WebGL2 in the built-in browser on 2026-10-08.

- SDK tilemap, terrain, collision and legacy scene regression: 239 tests passed.
- Editor tile, paint and stamp regression: 91 tests passed; one additional Wang-intent history regression passed afterwards (92 unique tests).
- SDK and editor production builds passed. The editor build includes TypeScript checking.
- Browser checks: 7 passed, covering non-mutating preview, a region crossing chunk boundaries, unchanged outside cells, undo, redo, missing Edge/Corner rules and consecutive undo restoring the original chunk extent.
- UI checks: cancel clears the reviewed delta; applying a 192-cell region creates one undo step. Saving and opening a new browser tab retains those 192 cells. Adding all four Edge peering bits lowers missing-rule cells from 1175 to 323; four undos restore 1175. The edited tileset was saved to disk.
- Saving stamp S1 writes the project JSON file; reopening reads S1 back from disk. Legacy migration, failed writes and a project switch during loading have windowless regression coverage.
- CLI Web export completed with no warnings or errors. The exported scene camera displays the map and atlas correctly in an independent browser tab, with no console errors. Native desktop and other target platforms were not tested in this run.

## Same-scene operation measurement

The edited area is 128×128 cells; two original negative-coordinate chunks remain, for 66 allocated 16×16 chunks. Each paired sample modifies one cell and immediately undoes it, using the same runtime and machine. The baseline uses the existing snapshot-based paint command; replacement uses a cell delta. Both include command/model/history work and native chunk export. These are synchronous CPU times, not GPU frame times.

| Implementation | Eight samples, milliseconds | Median |
| --- | --- | --- |
| Snapshot apply + undo | 1.60, 0.90, 0.90, 1.20, 0.70, 0.60, 0.50, 0.50 | 0.80 ms |
| Cell delta apply + undo | 0.50, 0.50, 0.20, 0.20, 0.40, 0.20, 0.20, 0.30 | 0.25 ms |

Collision-outline tests also verify that an unchanged chunk keeps the same geometry objects, and removing a chunk does not rebuild its neighbours. Chunk decoding/model serialization still read the full blob; ordinary brush strokes retain their existing snapshot history. This measurement does not establish a performance result for every map or device.

One test-page reload crashed in the built-in browser. A fresh tab successfully reopened the saved map and project stamps; the reload failure was not attributed to a product change. No desktop test process was launched.
