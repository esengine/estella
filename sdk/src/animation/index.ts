/**
 * @file    index.ts
 * @brief   Animation module barrel export
 */

export {
    Tween,
    TweenHandle,
    EasingType,
    TweenTarget,
    TweenState,
    LoopMode,
    initTweenAPI,
    shutdownTweenAPI,
    type TweenOptions,
    type BezierPoints,
} from './Tween';

export {
    ValueTweenHandle,
    applyEasing,
} from './ValueTween';

export {
    SpriteAnimator,
    spriteAnimatorSystemUpdate,
    registerAnimClip,
    unregisterAnimClip,
    getAnimClip,
    clearAnimClips,
    type SpriteAnimatorData,
    type SpriteAnimClip,
    type SpriteAnimFrame,
    type SpriteAnimEvent,
    type SpriteAnimEventHandler,
    spriteAnimatorGotoFrame,
    spriteAnimatorGotoLabel,
    onAnimEvent,
    onAnimEventGlobal,
    removeAnimEventListeners,
} from './SpriteAnimator';

export {
    AnimationPlugin,
    animationPlugin,
} from './AnimationPlugin';

export {
    TweenGroup,
    TweenSequence,
    TweenCompose,
    tweenCompositionManager,
} from './TweenGroup';

export {
    parseAnimClipData,
    extractAnimClipTexturePaths,
    type AnimClipAssetData,
} from './AnimClipLoader';
