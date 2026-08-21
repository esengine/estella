import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { roundSystem } from './systems/round';
import { hudSystem } from './systems/hud';

addSystemToSchedule(Schedule.Update, roundSystem);
// After the clock, so the labels never show the tick they were written before.
addSystemToSchedule(Schedule.PostUpdate, hudSystem);
