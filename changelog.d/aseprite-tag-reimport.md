---
section: Fixed
commits:
  - fix(pipeline): preserve Aseprite tag clips across reimport
  - fix(editor): refresh animations detached during source import
---
**Reordering Aseprite tags keeps placed animations on the right action.** The editor and command-line importer match tag names even when several names produce the same filename. Removing or renaming a tag keeps the previous animation playable from its original reference and takes it out of the source's picker. Animations retired together share a copy of their previous sprite sheet. New clips keep non-Latin letters in their filenames, and importing chooses an available name when an existing asset occupies the preferred one.
