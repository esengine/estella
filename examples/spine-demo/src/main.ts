import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { switchSystem } from './systems/switch';

console.log('[spine-demo] press 1-5 to switch: idle / walk / run / jump / shoot');
console.log('[spine-demo] press D for the spine scene diagnostics');

addSystemToSchedule(Schedule.Update, switchSystem);
