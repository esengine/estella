import { addSystemToSchedule, Schedule } from 'esengine';

import { dragFocusSystem } from './systems/dragFocus';

addSystemToSchedule(Schedule.Update, dragFocusSystem);
