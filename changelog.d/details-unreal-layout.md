---
section: Changed
commits:
  - feat(editor): lay out Details choices, ranges, arrays and Sequencer properties as Unreal does
---
**The Details panel lays out choices, ranges, lists and Sequencer properties as Unreal's does.** Every choice is a combo box (two or three options were a segmented switch). A number with a range is one spin box whose fill shows how far along it is: drag across it, or click to type (it was a blue slider beside a number). A list (an animation track's or Animator layer's mask, a camera brain's custom blends, an On Event node's inputs) has its count, add and clear on its own row and one `Index [n]` row per element (a mask was a tree of checkboxes, a list a stack of cards). A Sequencer clip's Details are headed by the clip's name and split into Section, Animation, Easing and Extrapolation; a track's own properties (blend, weight, mask, root motion, name, mute, lock) show when its row is clicked, not on every clip. An On Event node's payload pins are its Inputs in the Details, a name and a type each, as a UE Custom Event's are, not a text row on the node.
