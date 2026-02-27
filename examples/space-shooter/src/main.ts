import { addStartupSystem, addSystemToSchedule, Schedule } from 'esengine';

import './components';
import { setupSystem } from './systems/setup';
import { playerMoveSystem, playerShootSystem } from './systems/player';
import { enemySpawnSystem, enemyAISystem } from './systems/enemy';
import { collisionSystem } from './systems/collision';
import { bulletMoveSystem, explosionSystem, starScrollSystem, boundarySystem } from './systems/effects';
import { hudSystem, gameOverSystem } from './systems/hud';

addStartupSystem(setupSystem);
addSystemToSchedule(Schedule.Update, playerMoveSystem);
addSystemToSchedule(Schedule.Update, playerShootSystem);
addSystemToSchedule(Schedule.Update, enemySpawnSystem);
addSystemToSchedule(Schedule.Update, enemyAISystem);
addSystemToSchedule(Schedule.Update, bulletMoveSystem);
addSystemToSchedule(Schedule.Update, collisionSystem);
addSystemToSchedule(Schedule.Update, explosionSystem);
addSystemToSchedule(Schedule.Update, starScrollSystem);
addSystemToSchedule(Schedule.Update, boundarySystem);
addSystemToSchedule(Schedule.Update, hudSystem);
addSystemToSchedule(Schedule.Update, gameOverSystem);
