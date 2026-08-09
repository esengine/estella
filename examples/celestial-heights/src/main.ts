import { addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { playerMoveSystem, playerAttackSystem } from './systems/player';
import {
    meleeResolveSystem, damageSystem, invulnerabilitySystem, deathSystem,
} from './systems/combat';
import { healthBarSystem, hitFlashSystem } from './systems/feedback';
import { cameraBindSystem, navFromTerrainSystem, gateSystem } from './systems/world';
import { perceiverFacingSystem } from './ai/wisp';

// Perception, nav following, the behaviour-tree tick and scene switching are
// engine plugins, and the runtime already knows every .esscene the package
// ships by its file name — so only the project's own systems appear here.

// The world systems run every frame rather than at startup: an area switch
// brings a new camera, a new terrain and a new player, and startup is long past.
addSystemToSchedule(Schedule.PreUpdate, navFromTerrainSystem);
addSystemToSchedule(Schedule.PreUpdate, cameraBindSystem);

addSystemToSchedule(Schedule.Update, playerMoveSystem);
addSystemToSchedule(Schedule.Update, playerAttackSystem);
addSystemToSchedule(Schedule.Update, perceiverFacingSystem);
addSystemToSchedule(Schedule.Update, gateSystem);

// Damage resolves after everyone has decided to swing, and death after damage,
// so a hit lands in the frame it was thrown rather than the next one.
addSystemToSchedule(Schedule.PostUpdate, meleeResolveSystem);
addSystemToSchedule(Schedule.PostUpdate, damageSystem);
addSystemToSchedule(Schedule.PostUpdate, deathSystem);
addSystemToSchedule(Schedule.PostUpdate, invulnerabilitySystem);
addSystemToSchedule(Schedule.PostUpdate, healthBarSystem);
addSystemToSchedule(Schedule.PostUpdate, hitFlashSystem);
