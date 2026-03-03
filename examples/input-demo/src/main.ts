import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { keyboardMoveSystem } from './systems/keyboard';
import { mouseFollowSystem, mouseClickSystem } from './systems/mouse';
import { trailSystem } from './systems/trail';

addSystemToSchedule(Schedule.Update, keyboardMoveSystem);
addSystemToSchedule(Schedule.Update, mouseFollowSystem);
addSystemToSchedule(Schedule.Update, mouseClickSystem);
addSystemToSchedule(Schedule.Update, trailSystem);
