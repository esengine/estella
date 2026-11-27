---
section: Fixed
commits:
  - fix(editor): keep dropdown search mode stable while choices update
  - fix(project): ship stable focus for live dropdown choices
---
**Changing choices keeps focus in an open inspector dropdown.** Entity and enum pickers keep their search field or focused option when choice counts cross the search threshold. A bulk update that fills an entity picker switches it to a searchable list with a bounded number of rendered rows.
