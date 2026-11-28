---
section: Fixed
commits:
  - fix(audio): resolve sound event clips from their authored document
  - fix(editor): resolve relative sound event clips during preview
---
**Sound events keep their recordings in preview and exports.** Relative clip references resolve from the authored event. Exports include all declared candidates, including indexed clips without extensions, and skip unrelated editor metadata.
