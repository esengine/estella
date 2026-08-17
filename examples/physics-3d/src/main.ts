import { addSystemToSchedule, Schedule } from 'esengine';

import { controlSystem, debugToggleSystem, showShapesSystem } from './systems/control';
import { cameraFollowSystem } from './systems/camera';

// The 3D world itself needs no wiring: a scene carrying 3D components gets it.
addSystemToSchedule(Schedule.Startup, showShapesSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, debugToggleSystem);
addSystemToSchedule(Schedule.Update, cameraFollowSystem);
