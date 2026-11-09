import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { coinBobSystem, coinPickupSystem } from './systems/coin';
import { scoreSystem } from './systems/score';

addSystemToSchedule(Schedule.Update, coinPickupSystem);
addSystemToSchedule(Schedule.Update, coinBobSystem);
addSystemToSchedule(Schedule.Update, scoreSystem);
