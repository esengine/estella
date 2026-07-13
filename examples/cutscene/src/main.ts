import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { heroMoveSystem, replaySystem } from './systems/gameplay';

// Only project-specific systems are registered here. The FSM tick
// (StateMachineAgent) and timeline playback (TimelinePlayer) are the engine's
// built-in plugins — the cutscene itself needs no wiring at all.
addSystemToSchedule(Schedule.Update, heroMoveSystem);
addSystemToSchedule(Schedule.Update, replaySystem);
