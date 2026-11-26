---
section: Fixed
commits:
  - fix(grip): preview clips with timeline bindings and nested poses
  - fix(editor): ship grip preview timeline bindings
---
**Grip clip previews follow timeline bindings and nested poses.** The viewport applies the same property and animation tracks as Sequencer, honors muted channels, and restores each actor's scene pose when a binding changes or the preview ends.
