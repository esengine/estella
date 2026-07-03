// UI Layout — a live flexbox playground. The scene carries only a Camera +
// Canvas; a startup system builds a real FlexContainer full of item boxes plus
// a row of cycle-buttons that drive its properties:
//
//   • Dir      — flex-direction (row / column / *-reverse)
//   • Justify  — justify-content (start / center / end / space-*)
//   • Align    — align-items (start / center / end / stretch)
//   • Wrap     — flex-wrap (nowrap / wrap)
//   • Items    — how many boxes to lay out
//
// Click a button and the Yoga layout pass re-flows the boxes next frame. Built
// imperatively from the widget factories + design tokens, matching ui-controls.
import { addStartupSystem } from 'esengine';

import { buildSystem } from './systems/build';

addStartupSystem(buildSystem);
