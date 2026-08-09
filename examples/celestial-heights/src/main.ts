import {
    addSystemToSchedule, addSystemSetToSchedule, defineSystemSet, Schedule,
} from 'esengine';

import './components';
import { session } from './state';
import { playerMoveSystem, playerAttackSystem } from './systems/player';
import {
    meleeResolveSystem, damageSystem, invulnerabilitySystem, deathSystem,
} from './systems/combat';
import { healthBarSystem, hitFlashSystem, vitalityMeterSystem } from './systems/feedback';
import { cameraBindSystem, navFromTerrainSystem, gateSystem } from './systems/world';
import { pauseInputSystem, pauseTimeSystem, pauseOverlaySystem } from './systems/pause';
import { cycleLanguageSystem } from './systems/settings';
import { perceiverFacingSystem } from './ai/wisp';

// Perception, nav following, the behaviour-tree tick and scene switching are
// engine plugins, and the runtime already knows every .esscene the package
// ships by its file name — so only the project's own systems appear here.

// The world systems run every frame rather than at startup: an area switch
// brings a new camera, a new terrain and a new player, and startup is long past.
addSystemToSchedule(Schedule.PreUpdate, navFromTerrainSystem);
addSystemToSchedule(Schedule.PreUpdate, cameraBindSystem);

// Everything the pause freezes says so once, as a set with one run condition,
// rather than the same paused check written into eight systems.
addSystemSetToSchedule(Schedule.Update, defineSystemSet('gameplay', {
    systems: [playerMoveSystem, playerAttackSystem, perceiverFacingSystem, gateSystem],
    runIf: () => !session.paused,
}));

// Damage resolves after everyone has decided to swing, and death after damage,
// so a hit lands in the frame it was thrown rather than the next one.
addSystemSetToSchedule(Schedule.PostUpdate, defineSystemSet('combat', {
    systems: [meleeResolveSystem, damageSystem, deathSystem, invulnerabilitySystem],
    runIf: () => !session.paused,
}));

// The pause itself and everything that reports state keep running: one has to be
// able to lift the pause, the rest have to be able to show it.
addSystemToSchedule(Schedule.Update, pauseInputSystem);
addSystemToSchedule(Schedule.Update, pauseTimeSystem);
addSystemToSchedule(Schedule.Update, cycleLanguageSystem);
addSystemToSchedule(Schedule.PostUpdate, pauseOverlaySystem);
addSystemToSchedule(Schedule.PostUpdate, healthBarSystem);
addSystemToSchedule(Schedule.PostUpdate, vitalityMeterSystem);
addSystemToSchedule(Schedule.PostUpdate, hitFlashSystem);
