---
section: Fixed
commits:
  - fix(assets): resolve suffixed scene references in packaged builds
---
**Packaged scenes can bind indexed textures whose references carry a query or fragment suffix.** The runtime resolves the reference to the staged file and keeps the correct texture frame when several images share an atlas page.
