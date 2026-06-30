// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Animation module barrel export
 */

export {
    EasingType,
    applyEasing,
    type BezierPoints,
} from './Easing';

export {
    TweenState,
    LoopMode,
    type TweenOptions,
} from './TweenTypes';

export {
    Tween,
    TweenAPI,
    TweenHandle,
    TweenTarget,
} from './Tween';

export {
    ValueTweenHandle,
    ValueTweenManager,
} from './ValueTween';

export {
    SpriteAnimator,
    SpriteAnimation,
    SpriteAnimationApi,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    type SpriteAnimFrame,
    type SpriteAnimEvent,
    type SpriteAnimEventHandler,
} from './SpriteAnimator';

export {
    Animator,
    AnimatorController,
    AnimatorControllerApi,
    evaluateAnimatorTransitions,
    evaluateAnimatorPath,
    enterStatePath,
    leafStateOf,
    resolveParams,
    selectBlendClip,
    STATE_PATH_SEP,
    type AnimatorData,
    type AnimatorBlend1D,
    type AnimatorBlendThreshold,
    type AnimatorSpineMotion,
    type AnimatorSubMachine,
    type AnimatorScope,
    type SpineAnimationDriver,
    type AnimatorParam,
    type AnimatorParamType,
    type AnimatorCondition,
    type AnimatorTransition,
    type AnimatorState,
    type AnimatorControllerDef,
    type AnimatorParamValues,
    type AnimatorEvalResult,
    type AnimatorPathEvalResult,
} from './Animator';

export {
    AnimationPlugin,
    animationPlugin,
} from './AnimationPlugin';

export {
    TweenGroup,
    TweenSequence,
    TweenCompositionManager,
    type Completable,
    type TweenFactory,
} from './TweenGroup';

export {
    parseAnimClipData,
    extractAnimClipTexturePaths,
    type AnimClipAssetData,
} from './AnimClipLoader';
