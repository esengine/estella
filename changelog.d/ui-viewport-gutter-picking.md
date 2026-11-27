---
section: Fixed
commits:
  - fix(editor): respect each UI viewport during selection
---
**UI selection follows the viewport that drew it.** Edit and Play clicks skip world UI in preview gutters while allowing HUD selection wherever the overlay is drawn. Marquee selection clips each UI domain to its own viewport.
