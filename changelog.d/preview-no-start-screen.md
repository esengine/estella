---
section: Changed
commits:
  - fix(export): a development preview carries no start screen of its own
---
**A browser or device preview opens on the game alone.** A development preview (Browser and Scan Preview in the editor) used to open on a start screen the project never made: its title over a loading bar and a "Loading…" label. It now carries no start screen at all, only the project's own page; a shipped build keeps the start screen its project set.
