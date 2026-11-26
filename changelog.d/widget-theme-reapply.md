---
section: Changed
commits:
  - perf(ui): skip unchanged widget color writes when applying a theme
---
**Reapplying project settings is faster in scenes with many themed widgets.** The theme pass updates only colors that differ from their roles. Changing another project setting can now leave matching text, visuals and interaction states in place.
