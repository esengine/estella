import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { rotateSystem, colorPulseSystem } from './systems/animate';

addSystemToSchedule(Schedule.Update, rotateSystem);
addSystemToSchedule(Schedule.Update, colorPulseSystem);
