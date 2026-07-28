import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { switchSystem } from './systems/switch';

console.log('[dragonbones-demo] press 1-4 to crossfade: stand / walk / jump / fall');

addSystemToSchedule(Schedule.Update, switchSystem);
