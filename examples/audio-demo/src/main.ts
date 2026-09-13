// Audio — a drum machine over the engine's audio system: one-shot pads, a looping
// beat on the music bus, per-bus volume, a real spectrum visualizer, and a spatial
// source orbiting the listener. Controls and what each part shows: README.md.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { preloadSystem } from './systems/preload';
import { sfxSystem } from './systems/sfx';
import { beatSystem } from './systems/beat';
import { orbitSystem } from './systems/orbit';
import { volumeSystem } from './systems/volume';
import { visualizerSystem } from './systems/visualizer';

addStartupSystem(preloadSystem);
addSystemToSchedule(Schedule.Update, sfxSystem);
addSystemToSchedule(Schedule.Update, beatSystem);
addSystemToSchedule(Schedule.Update, orbitSystem);
addSystemToSchedule(Schedule.Update, volumeSystem);
addSystemToSchedule(Schedule.Update, visualizerSystem);
