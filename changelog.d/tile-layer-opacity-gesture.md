---
section: Fixed
commits:
  - fix(editor): close tile opacity gestures on pointer interruption
  - fix(project): ship tile opacity gesture recovery
---
**Interrupted tile opacity drags restore the original value.** Dropping the pointer or closing the layer panel during a drag
cancels the opacity edit. Releasing normally, including outside the slider, records the complete drag as one undo step.
