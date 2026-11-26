---
section: Fixed
commits:
  - fix(terrain): bind heightmap transfers to their original ground
  - fix(editor): ship terrain heightmap target checks
---
**Heightmap transfers stay with the terrain that started them.** Importing an image waits for any project handoff before editing
terrain or writing tiles. Both import and export cancel if the original scene or ground has been replaced.
