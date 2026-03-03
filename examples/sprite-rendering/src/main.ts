import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { waveSystem, orbitSystem, flipSystem } from './systems/animate';

addSystemToSchedule(Schedule.Update, waveSystem);
addSystemToSchedule(Schedule.Update, orbitSystem);
addSystemToSchedule(Schedule.Update, flipSystem);
