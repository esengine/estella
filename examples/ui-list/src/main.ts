// UI List — a data-driven, virtualized list and grid built with createListView:
// 500 rows / 120 tiles backed by a handful of recycled entities, mouse-wheel
// scrolling, live append/remove, and scrollToIndex jumps.
import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import { buildSystem } from './systems/build';
import { statsSystem } from './systems/stats';

addStartupSystem(buildSystem);
addSystemToSchedule(Schedule.Update, statsSystem);
