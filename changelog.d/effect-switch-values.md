---
section: Fixed
commits:
  - fix(editor): refuse a value between the steps of an effect's switch
---
**A post effect's switch takes only the values it has.** A uniform such as the Sky Atmosphere's Light the Scene is 0 or 1 and read by a threshold; written through automation as 0.4, it did what 0 does while the scene said otherwise. Writing a value between its steps is now refused, naming the values it takes.
