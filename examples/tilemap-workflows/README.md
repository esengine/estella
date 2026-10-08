# Tilemap Workflows

Open `project.esproject`, select **Ground**, and enter Tilemap mode. The 48×32 map spans negative coordinates and six 16×16 chunks. Its partial Edge, Corner and Wang rules deliberately leave gaps for diagnosis.

1. Use the selection tool to mark a region, or enable **Entire layer** in **Replace tiles**.
2. Preview tile ID **1 → 2**. Blue cells and the difference list show the affected region; the map remains unchanged until **Apply**.
3. Apply, undo, redo, and save/reopen. Border tiles (ID 3) retain their collision.
4. Enable **Highlight missing terrain rules**. Orange cells need an exact rule. Edit the matching terrain in the Tileset editor and verify the count changes.
5. Paint Wang color transitions; missing combinations remain diagnosable after saving.
6. Save a brush as a stamp. The library is stored in `assets/editor/tile-stamps.json`, so it travels with the project. Existing browser-local libraries migrate on first load; the original data is removed only after a successful file write.

Export for Web to inspect the authored map with its active scene camera. Review overlays are editor-only.
