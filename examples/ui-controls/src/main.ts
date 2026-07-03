// UI Controls — widget factories (button/slider/toggle/progress/dropdown/dialog)
// slotted into a scene-authored FlexContainer panel.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';
import { controlsSystem } from './systems/controls';

addStartupSystem(buildSystem);
addSystemToSchedule(Schedule.Update, controlsSystem);
