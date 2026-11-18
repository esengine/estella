---
section: Changed
commits:
  - fix(editor): the editor's chrome stops competing with the scene - wells a step above the panel, accent only where something is selected or running, axis letters coloured only while their field is used, no dot on every component header, a quiet viewport readout, a thin camera frustum and a lower asset drawer
---
**The editor's panels are quieter, so the scene is what stands out.** Input fields sit a step lighter than their panel
with a thin edge, where they were blacker than the window chrome. Add and Add Component are plain buttons; the accent
is left to selection, toggles that are on, and Play. A vector field's X, Y and Z letters take their axis colour only
while the field is hovered, focused or dragged, and a component header no longer carries a dot for "a field differs
from its default", which nearly every component showed. In the viewport the coordinate readout has no frame, a
selected camera's frustum is drawn thin, and a new layout gives the content drawer less height (220 px instead of
300); a saved layout keeps its own until View > Reset Layout.
