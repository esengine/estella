---
section: Fixed
commits:
  - fix(assets): handle URL suffixes and resolver failures in preloads
---
**Asset preload lists accept URLs with query strings or fragments and continue after an individual resolver error.** The filename determines the loader when no type is declared. The loader receives the original URL, and errors from resolving a reference appear in the batch's failed entries.
