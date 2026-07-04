import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { waveSystem, orbitSystem, spinSystem } from './systems/animate';

addSystemToSchedule(Schedule.Update, waveSystem);
addSystemToSchedule(Schedule.Update, orbitSystem);
addSystemToSchedule(Schedule.Update, spinSystem);
