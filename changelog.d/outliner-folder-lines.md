---
section: Fixed
commits:
  - "fix(editor): draw no tree line under an Outliner folder"
---
**Outliner folders no longer draw a tree line under their contents.** The line says that a row is parented to the one above
it, and a folder only groups. Under a folder it read as a stray rule between two columns of arrows, and it ran through the
selection highlight. Entities parented to other entities keep their lines, inside a folder or not.
