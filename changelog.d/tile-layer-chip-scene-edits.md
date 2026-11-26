---
section: Changed
commits:
  - perf(editor): defer tile layer enumeration until the menu opens
  - perf(project): ship lighter tile layer toolbar updates
---
**The closed layer menu stays responsive while other entities are edited.** The toolbar chip observes the selected layer’s
name, and the full layer list is read when the menu opens.
