import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { switchSystem } from './systems/switch';

console.log('[spine-demo] press 1-5 to switch: idle / walk / run / jump / shoot');

addSystemToSchedule(Schedule.Update, switchSystem);
