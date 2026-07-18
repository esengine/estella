// Camera Follow — a tour of the camera director:
//
//   • FollowTarget   — the scene camera damps toward the WASD player with a
//     dead zone, so small moves don't drag the view (Cinemachine-style Body).
//   • shakeCamera    — Space triggers a decaying render-only shake that never
//     dirties the camera's Transform.
//   • setViewTarget  — keys 1/2 blend the view between the follow camera and a
//     fixed wide-angle overview camera over 1.2 s with an EaseInOut curve.
//
// The follow, shake, and blend systems are all engine built-ins (CameraPlugin);
// project code only spawns the world, moves the player, and issues director
// requests from input.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { playerMoveSystem } from './systems/move';
import { cameraDirectorSystem } from './systems/director';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, playerMoveSystem);
addSystemToSchedule(Schedule.Update, cameraDirectorSystem);
