import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { animateSystem } from './systems/animate';

addSystemToSchedule(Schedule.Update, animateSystem);
