import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { runInputSystem, sprintSystem, progressSystem } from './systems/run';
import { coreBobSystem, hazardSystem, interactSystem } from './systems/world';
import { lifecycleSystem } from './systems/lifecycle';
import { hudSystem, openingSystem } from './systems/hud';

// Order is the frame's argument: input becomes edges, the world reacts to them,
// the lifecycle decides what state that leaves the run in, and only then is the
// player told. A HUD read before the lifecycle would show the frame before.
addSystemToSchedule(Schedule.Update, runInputSystem);
addSystemToSchedule(Schedule.Update, sprintSystem);
addSystemToSchedule(Schedule.Update, progressSystem);
addSystemToSchedule(Schedule.Update, coreBobSystem);
addSystemToSchedule(Schedule.Update, hazardSystem);
addSystemToSchedule(Schedule.Update, interactSystem);
addSystemToSchedule(Schedule.Update, lifecycleSystem);
addSystemToSchedule(Schedule.Update, hudSystem);
addSystemToSchedule(Schedule.Update, openingSystem);
