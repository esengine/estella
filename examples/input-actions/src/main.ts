// Input Actions — named actions (InputMap) + gestures (GestureDetector).
// The map itself lives in actions.ts; importing it registers the evaluation
// system. See input-demo for the raw Input resource this builds on.
import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import './actions';
import { shipSystem, bulletSystem } from './systems/ship';
import { gestureSystem } from './systems/gestures';
import { hudSystem } from './systems/hud';

addSystemToSchedule(Schedule.Update, gestureSystem);
addSystemToSchedule(Schedule.Update, shipSystem);
addSystemToSchedule(Schedule.Update, bulletSystem);
addSystemToSchedule(Schedule.Update, hudSystem);
