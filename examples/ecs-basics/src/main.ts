import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { moveSystem } from './systems/move';
import { bounceSystem } from './systems/bounce';
import { lifetimeSystem } from './systems/lifetime';
import { spawnerSystem } from './systems/spawner';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, spawnerSystem);
addSystemToSchedule(Schedule.Update, moveSystem);
addSystemToSchedule(Schedule.Update, bounceSystem);
addSystemToSchedule(Schedule.Update, lifetimeSystem);
