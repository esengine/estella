// Save & Load — SaveManager (versioned slots + migration on load) over the
// Storage API, plus raw Storage for a lightweight preference.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { buildSystem } from './systems/build';
import { moveSystem } from './systems/move';
import { coinSyncSystem, coinCollectSystem, coinPulseSystem } from './systems/coins';
import { hudSystem } from './systems/hud';

addStartupSystem(buildSystem);
addSystemToSchedule(Schedule.Update, moveSystem);
addSystemToSchedule(Schedule.Update, coinCollectSystem);
addSystemToSchedule(Schedule.Update, coinSyncSystem);
addSystemToSchedule(Schedule.Update, coinPulseSystem);
addSystemToSchedule(Schedule.Update, hudSystem);
