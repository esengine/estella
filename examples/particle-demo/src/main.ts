// Particle Effects — a gallery of the engine's ParticleEmitter, paged with
// on-screen buttons.
//
//   • Prev / Next buttons (or ← / → / Space) switch between six composed
//     showcases: Campfire, Fireworks, Magic Portal, Fountain, Snowfall, Sparkles.
//   • Left-click empty space — throw a one-shot firework at the cursor.
//
// Each showcase is a group of ParticleEmitter entities spawned on switch and
// despawned on the next switch — one scene, no reloads, so the UI and camera
// persist. Buttons are plain UI entities; a click surfaces as a 'click' event
// the switch system reads. See systems/switch.ts.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { switchSystem } from './systems/switch';
import { sparkSystem } from './systems/spark';
import { cleanupSystem } from './systems/cleanup';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, switchSystem);
addSystemToSchedule(Schedule.Update, sparkSystem);
addSystemToSchedule(Schedule.Update, cleanupSystem);
