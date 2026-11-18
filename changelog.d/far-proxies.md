---
section: Added
commits:
  - feat(residency): a streamed world can bake each cell a far proxy that stands in for it while it is not resident - the cell's static, opaque meshes merged per material and simplified at build time, handed over with no gap either way
---
**A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded.** Tick **Far proxies** on `StreamedWorld` and a build bakes every cell a stand-in from its static, opaque meshes, prefab instances included: merged into one draw per material and simplified within `proxyError` world units (aiming at `proxyRatio` of the triangles). While a source is within `farDistance` of a cell that is not resident, the cell's proxy is drawn in its place. The hand-over leaves no gap in either direction: walking towards a cell, its proxy stays until the cell is in the world, and walking away, the cell stays until its proxy is. Play makes the same proxies in memory without simplifying them. Off by default; the cooked manifest names each proxy (`WorldCell.proxy`, `WorldManifest.farDistance`), and `WorldStreamerStatus.proxyCells` lists the cells drawn by one.
