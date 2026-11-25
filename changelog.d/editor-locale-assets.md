---
section: Fixed
commits:
  - fix(i18n): load and order editor locale tables like the runtime
  - fix(editor): match locale table overrides to exported games
---
**The editor's language preview now resolves overlapping translations in the same order as the exported game.** Tables are applied by full project path. Editing a live `.eslocale` table reloads it through its registered asset loader.
