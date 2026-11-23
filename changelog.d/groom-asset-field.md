---
section: Fixed
commits:
  - fix(groom): a groom is an asset — picked in Details, registered with a uuid, shipped with its curves, and drawn in the edit viewport
  - feat(editor): a Groom's groom is picked or dropped from the Content Browser like any asset
---
**A Groom's groom is picked like any asset, and it ships.** The Groom component's field was a text box
you had to type a path into, and `.esgroom` / `.escurves` files were never registered (no `.meta`), so
nothing could be dragged onto it and an export carried neither file. A groom is now an asset field:
Details shows the asset picker (pick, drag from the Content Browser, locate), the scene stores a uuid
that survives a move, and an export ships the groom and the curves it names, rewritten to a path the
package has. A groom named by uuid no longer fails in Play with the curves "404 Not Found", and the
strands are built in the editor's viewport without pressing Play.
