---
section: Fixed
commits:
  - fix(editor): reuse the visible asset registry during revalidation
---
**Opening another scene can use the asset list already on screen while the editor checks it in the background.** Play and export still wait for that check before reading the project assets.
