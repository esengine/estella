import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { shotDirectorSystem } from './shots';

addSystemToSchedule(Schedule.Update, shotDirectorSystem);
