import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { progressAnimateSystem } from './systems/animate';

addSystemToSchedule(Schedule.Update, progressAnimateSystem);
