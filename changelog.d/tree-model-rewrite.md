---
section: Fixed
commits:
  - "fix(editor): write a tree model again, and say why a terrain or rules edit was refused"
---
**A tree model can be written again, and a refused terrain edit says why.** Writing or editing a model grown by the
`tree` step a second time was refused, as though the material its leaves made were someone else's. A terrain or rules
tool that refused a source answered with nothing the client could read; it now answers with the reason.
