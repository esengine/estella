import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { spawnSystem } from './systems/spawn';
import { dragSystem, shuttleSystem } from './systems/interact';

addSystemToSchedule(Schedule.Update, spawnSystem);
addSystemToSchedule(Schedule.Update, dragSystem);
addSystemToSchedule(Schedule.Update, shuttleSystem);
