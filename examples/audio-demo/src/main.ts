import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { sfxTriggerSystem } from './systems/sfx';
import { visualizerSystem } from './systems/visualizer';

addSystemToSchedule(Schedule.Update, sfxTriggerSystem);
addSystemToSchedule(Schedule.Update, visualizerSystem);
