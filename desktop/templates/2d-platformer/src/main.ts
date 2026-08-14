import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerSystem } from './systems/player';
import { coinBobSystem, coinPickupSystem } from './systems/coin';
import { scoreSystem } from './systems/score';

addSystemToSchedule(Schedule.FixedPreUpdate, playerSystem);
addSystemToSchedule(Schedule.Update, coinPickupSystem);
addSystemToSchedule(Schedule.Update, coinBobSystem);
addSystemToSchedule(Schedule.Update, scoreSystem);
