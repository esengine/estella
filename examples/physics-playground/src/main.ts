import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { spawnSystem } from './systems/spawn';

addSystemToSchedule(Schedule.Update, spawnSystem);
