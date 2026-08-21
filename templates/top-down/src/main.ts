import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { moveSystem } from './systems/move';
import { followSystem } from './systems/follow';

// Movement runs in the FIXED step, with the physics the character controller
// resolves against; the camera follows in the render step, so it is smooth at
// whatever rate the display runs.
addSystemToSchedule(Schedule.FixedPreUpdate, moveSystem);
addSystemToSchedule(Schedule.PostUpdate, followSystem);
