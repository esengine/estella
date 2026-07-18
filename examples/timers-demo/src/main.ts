// Timers — TimerManager scheduling (delay / interval / TimerHandle control /
// timeScale) instead of hand-rolled Time.delta accumulators.
import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { buildSystem } from './systems/build';
import { sparkSystem, drifterSystem, heartDecaySystem } from './systems/motion';
import { hudSystem } from './systems/hud';

addSystemToSchedule(Schedule.Update, buildSystem);
addSystemToSchedule(Schedule.Update, sparkSystem);
addSystemToSchedule(Schedule.Update, drifterSystem);
addSystemToSchedule(Schedule.Update, heartDecaySystem);
addSystemToSchedule(Schedule.Update, hudSystem);
