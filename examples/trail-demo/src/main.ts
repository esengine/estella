// Trails — a tour of the built-in trail renderer (the `TrailRenderer`
// component + the `Trail` resource):
//
//   • Comet    — rides a Lissajous figure with a long additive streak
//     (time 1.4 s, 26 px head tapering to 0, warm→transparent gradient).
//   • Follower — eases toward the mouse cursor with a short cool ribbon,
//     the classic cursor-trail.
//   • Dasher   — click anywhere and it dashes there in 0.14 s, leaving a
//     wide short-lived burst (44 px head, 0.25 s lifetime, additive).
//
// Trail points are recorded and aged by the engine's TrailSystem (TrailPlugin,
// play mode); project systems only move the emitters. The keys demonstrate
// runtime control: E flips `emitting` (freeze — the streak fades in place),
// C calls `trail.clear()` on every trail, T teleports the dasher home with a
// `clear` so no streak spans the jump.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { motionSystem } from './systems/motion';
import { controlSystem } from './systems/control';
import { labelSystem } from './systems/labels';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, motionSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, labelSystem);
