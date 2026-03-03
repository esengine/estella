import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { timerSystem } from './systems/timer';
import { spawnSystem } from './systems/spawn';
import { collectSystem } from './systems/collect';
import { scoreSystem } from './systems/score';
import { animateSystem } from './systems/animate';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, timerSystem);
addSystemToSchedule(Schedule.Update, spawnSystem);
addSystemToSchedule(Schedule.Update, collectSystem);
addSystemToSchedule(Schedule.Update, scoreSystem);
addSystemToSchedule(Schedule.Update, animateSystem);
