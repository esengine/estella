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
    SpriteAnimationAPI,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    type SpriteAnimFrame,
    type SpriteAnimEvent,
    type SpriteAnimEventHandler,
} from './SpriteAnimator';

export {
    Animator,
    AnimatorController,
    AnimatorControllerAPI,
    registerAnimatorController,
    getRegisteredAnimatorController,
    clearAnimatorControllerStore,
    evaluateAnimatorTransitions,
    evaluateAnimatorPath,
    enterStatePath,
    leafStateOf,
    resolveParams,
    selectBlendClip,
    motionOf,
    STATE_PATH_SEP,
    SPINE_MOTION,
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
    emptyAnimatorController,
    animatorEdges,
    addState as addAnimatorState,
    removeState as removeAnimatorState,
    moveState as moveAnimatorState,
    renameState as renameAnimatorState,
    setInitial as setAnimatorInitial,
    setStateClip as setAnimatorStateClip,
    setStateMotion as setAnimatorStateMotion,
    setStateProps as setAnimatorStateProps,
    addTransition as addAnimatorTransition,
    removeTransition as removeAnimatorTransition,
    updateTransition as updateAnimatorTransition,
    setConditions as setAnimatorConditions,
    addParam as addAnimatorParam,
    removeParam as removeAnimatorParam,
    updateParam as updateAnimatorParam,
    type AnimatorEdge,
} from './animatorGraph';

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
    parseAnimClipAsset,
    serializeAnimClip,
    createAnimClip,
    createAnimClipFromTextures,
    extractAnimClipTexturePaths,
    animClipSheetCols,
    animClipSheetRows,
    animClipCellRect,
    animClipCellUv,
    animClipDrivesPivot,
    animClipDrivesSize,
    animClipFramePivot,
    animClipFrameSize,
    ANIM_CLIP_FORMAT_VERSION,
    DEFAULT_ANIM_CLIP_PIVOT,
    type AnimClipAssetData,
    type AnimClipFrameData,
    type AnimClipSheetData,
    type AnimClipEventData,
    type AnimClipPivotData,
    type AnimClipVec2,
    type AnimClipSizing,
} from './AnimClipLoader';

export {
    MotionRegistry,
    selectBlendStop,
    blend1DMotionDriver,
    isBlend1D,
    type AnimatorMotion,
    type AnimatorClipMotion,
    type AnimatorBlend1DMotion,
    type AnimatorBlendStop,
    type MotionContext,
    type MotionDriver,
    type MotionParams,
} from './motion';

export {
    SPRITE_MOTION,
    spriteMotionDriver,
} from './spriteMotion';

export { Pose, type PoseTrack, type PoseWorld } from './pose';
export { mixPoses, type WeightedPose } from './poseMix';
