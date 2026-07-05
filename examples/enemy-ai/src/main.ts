import { addSystemToSchedule, Schedule } from 'esengine';
import { keyboardMoveSystem } from './player';
import { setupNavGridSystem } from './enemy';

// Only project-specific systems are registered here: the player controller and
// the one-time nav grid. Perception, the FSM tick (StateMachineAgent) and nav
// follow (NavAgent) are the engine's built-in AI plugins — no wiring needed.
addSystemToSchedule(Schedule.Startup, setupNavGridSystem);
addSystemToSchedule(Schedule.Update, keyboardMoveSystem);
