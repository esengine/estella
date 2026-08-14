import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { moveSystem } from './systems/move';
import { followSystem } from './systems/follow';
import { talkSystem } from './systems/talk';

addSystemToSchedule(Schedule.Update, moveSystem);
addSystemToSchedule(Schedule.Update, talkSystem);
// After the hero has moved, or the camera trails a frame behind them.
addSystemToSchedule(Schedule.PostUpdate, followSystem);
