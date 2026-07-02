// Tween Animation — a tour of the engine's built-in tween system (the `Tween`
// resource: `tween.to(...)`, `sequence()`, `parallel()`, `.bezier()`, easings).
//
//   • Easing gallery — a column of dots races the same track, each with a
//     different easing curve, so they visibly spread apart and regroup.
//   • Hero          — an endless sequence() of move → spin+colour steps, each
//     spin/colour pair run together with parallel().
//   • Comet         — click anywhere and it tweens to the cursor with an
//     overshooting ease and an elastic size pop.
//
// Tweens are driven by the built-in TweenSystem (via the AnimationPlugin); a
// system just starts them through the `Tween` resource. The C++ fast-path
// writes Transform/Sprite directly each frame — no per-frame lerp code here.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { cometSystem } from './systems/comet';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, cometSystem);
