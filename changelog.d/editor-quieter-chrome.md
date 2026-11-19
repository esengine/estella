---
section: Changed
commits:
  - fix(editor): the editor's chrome stops competing with the scene - wells a step above the panel, accent only where something is selected or running, axis letters coloured only while their field is used, no dot on every component header, a quiet viewport readout, a thin camera frustum and a lower asset drawer
  - fix(editor): a vector field's axis shows as a thin coloured edge down its well, always on, as Unreal marks a vector cell - the letter stays grey; colour only on hover lost the link to the gizmo's arms
  - fix(editor): a vector's value fits its well and the viewport toolbar is flat - the Details label column takes a third of the row, not two fifths, the axis tab is 12 px and a value still too long ends in an ellipsis, and the toolbar's mode and toggle groups lose their sunken ringed wells
  - fix(editor): a vector value too long for its well is cut by the box, not ended in an ellipsis - an ellipsis, like rounding the value down to fit, shows a number that is not the value; the digits shown are the value's own
---
**The editor's panels are quieter, so the scene is what stands out.** Input fields sit a step lighter than their panel
with a thin edge, where they were blacker than the window chrome. Add and Add Component are plain buttons; the accent
is left to selection, toggles that are on, and Play. A vector field's X, Y and Z letters are grey, its axis told by a
thin coloured edge down the left of each box, and a component header no longer carries a dot for "a field differs
from its default", which nearly every component showed. In the viewport the coordinate readout has no frame, a
selected camera's frustum is drawn thin, and a new layout gives the content drawer less height (220 px instead of
300); a saved layout keeps its own until View > Reset Layout.
The Details label column is a third of the row instead of two fifths, so a vector's values (298.78, not 298.7) fit
their boxes; one still too long is cut by the box edge, its digits never rounded or replaced. The viewport toolbar's World/Local, pivot and 2D/3D groups are flat
on the bar, set apart by space, where each sat in a sunken box.
