import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerMoveSystem, playerAttackSystem } from './systems/player';
import {
    meleeResolveSystem, damageSystem, invulnerabilitySystem, deathSystem,
} from './systems/combat';
import { healthBarSystem, hitFlashSystem } from './systems/feedback';
import { perceiverFacingSystem, setupNavGridSystem } from './ai/wisp';

// Perception, nav following and the behaviour-tree tick are engine plugins and
// need no wiring; only the project's own systems are registered here.
addStartupSystem(setupNavGridSystem);

addSystemToSchedule(Schedule.Update, playerMoveSystem);
addSystemToSchedule(Schedule.Update, playerAttackSystem);
addSystemToSchedule(Schedule.Update, perceiverFacingSystem);
// Damage resolves after everyone has decided to swing, and death after damage,
// so a hit lands in the frame it was thrown rather than the next one.
addSystemToSchedule(Schedule.PostUpdate, meleeResolveSystem);
addSystemToSchedule(Schedule.PostUpdate, damageSystem);
addSystemToSchedule(Schedule.PostUpdate, deathSystem);
addSystemToSchedule(Schedule.PostUpdate, invulnerabilitySystem);
addSystemToSchedule(Schedule.PostUpdate, healthBarSystem);
addSystemToSchedule(Schedule.PostUpdate, hitFlashSystem);
