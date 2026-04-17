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
    TweenHandle,
    TweenTarget,
    initTweenAPI,
    shutdownTweenAPI,
} from './Tween';

export {
    ValueTweenHandle,
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
