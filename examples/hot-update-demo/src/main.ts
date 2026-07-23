import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { hotDisplaySystem } from './systems/hotUpdate';

addSystemToSchedule(Schedule.Update, hotDisplaySystem);
