// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    ThirdPersonController,
    desiredDirection,
    approachVelocity,
    facingYaw,
    shortestAngleDelta,
    turnToward,
    rootMotionVelocity,
    TPC_SPEED,
    TPC_GROUNDED,
    TPC_DODGE,
    TPC_ATTACK,
    yawQuaternion,
    yawOfQuaternion,
    WORLD_BASIS,
    DODGE_KEY,
    ATTACK_KEY,
    type ThirdPersonControllerData,
    type MoveBasis,
} from './ThirdPersonController';

export {
    ThirdPersonCamera,
    orbitOffset,
    cameraGroundBasis,
    dampFactor,
    clampPitch,
    type ThirdPersonCameraData,
} from './ThirdPersonCamera';

export {
    Hunter,
    decideHunterState,
    huntTargets,
    driveHunterRootMotion,
    type HunterData,
    type HunterState,
    type HunterSituation,
} from './Hunter';

export {
    Health,
    Damage,
    applyDamage,
    type HealthData,
    type DamagePayload,
} from './Health';

export {
    MeleeAttack,
    MeleeAttacks,
    resolveMeleeHits,
    COMBAT_ATTACK_START,
    COMBAT_HIT,
    COMBAT_ATTACK_END,
    type MeleeAttackData,
    type MeleeOverlapQuery,
} from './MeleeAttack';

export {
    GameplayPlugin,
    gameplayPlugin,
    requestMotion,
    observeMotion,
    updateCameras,
} from './GameplayPlugin';
