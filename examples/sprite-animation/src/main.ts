// Sprite Animation — the engine's frame-animation stack, bottom to top:
//
//   • .esanim clips     — idle/walk load from assets with the scene; the hop
//                         clip is registered from code (both authoring paths).
//   • SpriteAnimator    — frame playback. The two background aliens run plain
//                         clips at their own speeds, no state machine involved.
//   • Animator (FSM)    — the player is driven by a state machine: a `speed`
//                         float switches Idle↔Move, Move is a 1D blend that
//                         re-selects walk×1.0 / walk×1.9 (run) as speed rises,
//                         and the Space `hop` trigger plays a non-looping clip
//                         whose exit time auto-returns to Idle.
//   • Frame events      — the walk clip's contact frames fire `footstep`
//                         events; a system turns them into fading dust puffs.
//
// Controls: ←/→ or A/D walk · hold Shift to run · Space to hop.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem, wireClipsSystem } from './systems/setup';
import { controlSystem } from './systems/control';
import { puffSystem } from './systems/puffs';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, wireClipsSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, puffSystem);
