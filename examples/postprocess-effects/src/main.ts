// Post-processing — a gallery of the engine's PostProcessVolume effects, paged
// with on-screen buttons.
//
//   • Prev / Next (or ← / → / Space) cycle the built-in effects, each applied
//     to the scene-wide volume.
//   • The final "Local Volume" page spawns a local volume that sweeps across the
//     camera, showing camera-relative volume blending.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { switchSystem } from './systems/switch';
import { animateSystem } from './systems/animate';
import { sweepSystem } from './systems/sweep';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, switchSystem);
addSystemToSchedule(Schedule.Update, animateSystem);
addSystemToSchedule(Schedule.Update, sweepSystem);
