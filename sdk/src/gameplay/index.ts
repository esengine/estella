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
    yawQuaternion,
    yawOfQuaternion,
    WORLD_BASIS,
    DODGE_KEY,
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
    GameplayPlugin,
    gameplayPlugin,
    TPC_SPEED,
    TPC_GROUNDED,
    TPC_DODGE,
    requestMotion,
    observeMotion,
    updateCameras,
} from './GameplayPlugin';
