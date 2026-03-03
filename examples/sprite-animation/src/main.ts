import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { switchSystem } from './systems/switch';

addSystemToSchedule(Schedule.Update, switchSystem);
