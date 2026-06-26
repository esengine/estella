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
