import { addSystemToSchedule, Schedule } from 'esengine';

import { walkSystem } from './systems/walk';
import { cameraFollowSystem } from './systems/camera';

// A scene carrying 3D components brings the 3D world with it — nothing to register.
// Walking is written in the fixed step, where the character solver reads it; the
// camera follows in the render step, so it is smooth at the display's own rate.
addSystemToSchedule(Schedule.FixedPreUpdate, walkSystem);
addSystemToSchedule(Schedule.PostUpdate, cameraFollowSystem);
