import { addSystemToSchedule, Schedule } from 'esengine';
import { keyboardMoveSystem } from './player';
import { setupNavGridSystem, enemySenseSystem } from './enemy';

// The nav grid is built once; perception + player movement run every frame. The
// FSM tick (StateMachineAgent) and nav follow (NavAgent) are driven by the
// engine's built-in fsm/nav plugins — no per-project wiring needed.
addSystemToSchedule(Schedule.Startup, setupNavGridSystem);
addSystemToSchedule(Schedule.Update, keyboardMoveSystem);
addSystemToSchedule(Schedule.Update, enemySenseSystem);
