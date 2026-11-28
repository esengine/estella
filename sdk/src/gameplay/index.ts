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
    TPC_JUMP,
    TPC_DODGE,
    TPC_ATTACK,
    TPC_SPRINT,
    TPC_STAGGER,
    yawQuaternion,
    yawOfQuaternion,
    WORLD_BASIS,
    DODGE_KEY,
    ATTACK_KEY,
    LOCK_KEY,
    type ThirdPersonControllerData,
    type MoveBasis,
} from './ThirdPersonController';

export {
    FirstPersonController, FirstPersonViewModel, lookAfter, walkDirection, crouchAfter, yawRotation, pitchRotation,
    type FirstPersonControllerData, type FirstPersonViewModelData,
} from './FirstPersonController';

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
    staggerHunter,
    type HunterData,
    type HunterState,
    type HunterSituation,
} from './Hunter';

export {
    Health,
    Damage,
    applyDamage,
    tickHealth,
    restoreToFull,
    type HealthData,
    type DamagePayload,
    type DamageOutcome,
} from './Health';

export {
    Stamina,
    spendStamina,
    regenerateStamina,
    type StaminaData,
} from './Stamina';

export {
    MeleeAttack,
    MeleeAttacks,
    resolveMeleeHits,
    sweepMeleeWindows,
    COMBAT_ATTACK_START,
    COMBAT_HIT,
    COMBAT_ATTACK_END,
    COMBAT_ATTACK_ACTIVE,
    COMBAT_COMBO_WINDOW,
    COMBAT_INVULNERABLE,
    type MeleeAttackData,
    type MeleeOverlapQuery,
    type MeleeWindowSource,
} from './MeleeAttack';

export {
    GameplayPlugin,
    gameplayPlugin,
    requestMotion,
    observeMotion,
    updateCameras,
    pickLockTarget,
} from './GameplayPlugin';

export {
    gridCellAt,
    gridCellCentre,
    snapToGrid,
    snapFootprint,
    checkPlacement,
    type PlacementGrid,
    type GridCell,
    type PlacementRect,
    type SnappedFootprint,
    type PlacementProbes,
    type PlacementCheck,
} from './placement';

export {
    nearestEntities,
    nearestMarkers,
    type NearEntity,
    type NearestOptions,
} from './nearest';
