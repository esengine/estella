---
section: Fixed
commits:
  - fix(editor): pass project material references to the lightmap worker
  - fix(lighting): inherit material cutoffs during lightmap baking
---
**Lightmap bakes honor inherited material alpha cutoffs.** Material instances follow parent UUIDs and document-relative references in editor and command-line bakes. An explicit zero cutoff still makes the surface solid for the bake.
