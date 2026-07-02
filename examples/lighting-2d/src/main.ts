// 2D Lighting — the engine's dynamic Light2D + ShadowCaster2D system shown
// interactively. The scene is a near-black room whose walls and props use a
// `Lit2D` material, so they are only visible where light reaches them.
//
//   • Move the mouse — a torch (Point light) follows the cursor, revealing the
//     room and casting soft shadows off the pillars.
//   • Left-click      — drop a fixed colored light (cycles red/green/blue/warm).
//   • Right-click     — drop a box obstacle that blocks light and casts shadow.
//   • C               — clear everything you placed.
//
// Lighting is multiplicative (surface = albedo × (ambient + Σ lights)), so an
// unlit surface is nearly black and each light adds to it — the reason a torch
// "reveals" the room rather than merely brightening it.
import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { torchSystem } from './systems/torch';
import { placeSystem } from './systems/place';
import { fadeSystem } from './systems/fade';

addSystemToSchedule(Schedule.Update, torchSystem);
addSystemToSchedule(Schedule.Update, placeSystem);
addSystemToSchedule(Schedule.Update, fadeSystem);
