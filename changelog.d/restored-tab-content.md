---
section: Fixed
commits:
  - fix(layout): an asset editor restored in front of the viewport shows its content
---
**An editor tab left open in front of the scene view opens with its content.** Reopening a project whose layout had an asset editor (an animation controller, say) as the front tab of the scene's group showed that tab empty until another tab was clicked and back; it now shows its editor at once.
