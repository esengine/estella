---
section: Changed
commits:
  - perf(editor): index generated assets for inspector slots
---
**Inspector asset slots reuse generated asset lookups within each project scan.** Dropping or selecting a source file still offers its matching generated assets, including legacy model products and products imported into another folder.
