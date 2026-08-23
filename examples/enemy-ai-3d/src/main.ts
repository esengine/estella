import { addSystemToSchedule, Schedule } from 'esengine';
import { chaseSystem, faceTargetSystem } from './enemy';
import { cameraFollowSystem, controlSystem, gateSystem, showWorldSystem } from './player';

// Only project systems are registered here. Perception, the navmesh bake and the
// agent follow are the engine's own AI plugins — the scene authors a NavVolume, a
// NavLink and a NavObstacle, and nothing in code has to bake or join anything.
addSystemToSchedule(Schedule.Startup, showWorldSystem);
addSystemToSchedule(Schedule.Update, controlSystem);
addSystemToSchedule(Schedule.Update, gateSystem);
addSystemToSchedule(Schedule.Update, chaseSystem);
addSystemToSchedule(Schedule.Update, faceTargetSystem);
addSystemToSchedule(Schedule.Update, cameraFollowSystem);
