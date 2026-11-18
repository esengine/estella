---
section: Added
commits:
  - feat(render): the engine says how a loaded probe volume is laid out - probe_volume_getResolution, probe_volume_getBricks and probeVolumeLayout, what an editor draws to show where a sparse bake put its bricks
  - feat(editor): a selected probe volume shows what its bake laid down - a sparse grid's bricks coloured by span (violet finest, then amber, pale yellow and grey) and a dense grid's probes at its baked resolution, both read from the grid the engine loaded
---
**A selected probe volume shows what its bake laid down.** A volume baked sparse draws its bricks, coloured by how far apart their probes are (violet for the finest, amber, pale yellow and grey for 2, 4 and 8 times coarser); one baked dense draws a cross at each probe at its baked resolution. Both come from the grid the engine loaded, so the editor shows what the frame reads rather than what the component's spacing would ask for now. `probeVolumeLayout` gives a tool of your own the same layout.
