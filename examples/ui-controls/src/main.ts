// UI Controls — button, toggle, toggle group, slider, progress, dropdown, text
// input, a modal and a scroll view, every one of them authored in the scene the
// way the editor's Create → UI menu drops it. The code only answers what they do.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import { wireSystem } from './systems/wire';
import { controlsSystem } from './systems/controls';

addSystemToSchedule(Schedule.Update, wireSystem);
addSystemToSchedule(Schedule.Update, controlsSystem);
