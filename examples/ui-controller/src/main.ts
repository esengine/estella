// UI Controllers & Gears — a shared UIController drives many elements through
// declarative UIGears (no per-widget state code). Built lazily in an Update
// system so it runs once the scene's Canvas exists.
import { addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';

addSystemToSchedule(Schedule.Update, buildSystem);
