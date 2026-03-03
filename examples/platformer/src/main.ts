import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerSystem } from './systems/player';
import { coinSystem } from './systems/coin';

addSystemToSchedule(Schedule.Update, playerSystem);
addSystemToSchedule(Schedule.Update, coinSystem);
