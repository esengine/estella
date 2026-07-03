// Audio — a drum machine that shows off the engine's audio system: pad SFX with
// per-hit pitch/pan, a looping beat on the music bus, per-bus volume control, and
// a real spectrum visualizer fed by the master-bus analyser.
//
//   • Keys 1-4 or click the pads    — Kick / Snare / Hi-Hat / Clap
//   • Beat button                   — toggle the looping music-bus beat
//   • Master / Music / SFX buttons  — cycle each bus's volume
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { preloadSystem } from './systems/preload';
import { sfxSystem } from './systems/sfx';
import { beatSystem } from './systems/beat';
import { volumeSystem } from './systems/volume';
import { visualizerSystem } from './systems/visualizer';

addStartupSystem(preloadSystem);
addSystemToSchedule(Schedule.Update, sfxSystem);
addSystemToSchedule(Schedule.Update, beatSystem);
addSystemToSchedule(Schedule.Update, volumeSystem);
addSystemToSchedule(Schedule.Update, visualizerSystem);
