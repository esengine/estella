// Custom Drawing — the engine's three drawing tiers side by side:
//
//   • Draw     — immediate mode: a radar overlay (sweep, pulse rings, drone
//     bounding boxes) re-issued from scratch every frame in a draw callback.
//   • Graphics — retained path recorder: a star built once and replayed with
//     flush(); G clears and re-records it with new parameters.
//   • Mesh2D   — component mesh: a scene-authored ribbon whose vertices are
//     regenerated each frame and re-uploaded through the Meshes2D resource.
//
// Importing radar.ts / star.ts registers their draw callbacks
// (registerDrawCallback) as a side effect; systems only feed them data.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { droneSystem } from './systems/radar';
import { starRebuildSystem } from './systems/star';
import { ribbonSystem } from './systems/ribbon';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, droneSystem);
addSystemToSchedule(Schedule.Update, starRebuildSystem);
addSystemToSchedule(Schedule.Update, ribbonSystem);
