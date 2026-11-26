---
section: Fixed
commits:
  - fix(editor): write imported terrain images as one file batch
  - fix(project): ship terrain import file rollback
---
**Failed heightmap imports restore the files they replaced.** All tile and overview images are encoded and staged before
publication. If publishing a file fails, Estella restores the files already published in that import.
