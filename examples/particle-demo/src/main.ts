// Particle Effects — an interactive tour of the ParticleEmitter component and
// the `Particle` runtime API.
//
//   • Move the mouse — a World-space emitter follows the cursor, leaving trails.
//   • 1–6 / Space    — switch its preset: Fire, Sparks, Smoke, Magic, Snow,
//     Fountain (each remixes the emitter's shape, velocity, colour, size, gravity
//     and blend mode live).
//   • Left-click     — spawn a one-shot firework burst at the cursor.
//   • P              — pause / resume the follow stream (Particle.stop / play).
//
// Emitters are plain ECS components simulated by the built-in ParticleSystem;
// systems here only start them, mutate their fields, and use the `Particle`
// resource for play/stop and getAliveCount-driven cleanup.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { followSystem } from './systems/follow';
import { controlSystem } from './systems/control';
import { cleanupSystem } from './systems/cleanup';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, followSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, cleanupSystem);
