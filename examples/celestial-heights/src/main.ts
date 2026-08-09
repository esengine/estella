import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerMoveSystem } from './systems/player';

addSystemToSchedule(Schedule.Update, playerMoveSystem);
