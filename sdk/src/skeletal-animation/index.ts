// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  esengine/skeletal-animation — the animator graph and grip poses.
 *
 * Importing this is what installs them on a lean entry. The names are also
 * exported from `esengine` itself, so a script that imports them from there
 * reaches the same code; what the subpath adds is the installation.
 */
export {
    Animator, AnimatorController, AnimatorControllerAPI,
    type AnimatorData, type AnimatorControllerDef,
} from '../animation/Animator';
export { SkeletalAnimationPlugin, skeletalAnimationPlugin } from '../animation/SkeletalAnimationPlugin';
export { GripPose, GripSurface, GripProfile, GripHolder } from '../animation';

import { registerSkeletalAnimationSupport } from '../animation/skeletalAnimationSupport';

registerSkeletalAnimationSupport();
