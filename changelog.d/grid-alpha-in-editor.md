---
internal: The editor grid's linear-light alpha correction moved from the SDK grid renderer to the editor, which already sets the grid's colour; the grid looks the same.
commits:
  - refactor(editor): the grid's linear-light alpha is set where its colour is
  - refactor(render): the editor grid renderer reads no colour space
---
