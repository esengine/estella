---
section: Fixed
commits:
  - fix(assets): share indexed preload types with project packaging
---
**Asset preloads use the project's indexed types for ambiguous files.** The SDK and packager share the mapping from project types to runtime loaders, so a Spine skeleton stored as JSON goes to the Spine loader. Explicit manifest and catalog types still take priority.
