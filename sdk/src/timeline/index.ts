export {
    WrapMode,
    TrackType,
    type Keyframe,
    type PropertyChannel,
    type PropertyTrack,
    type SpineClip,
    type SpineTrack,
    type SpriteAnimTrack,
    type AudioEvent,
    type AudioTrack,
    type ActivationRange,
    type ActivationTrack,
    type Track,
    type TimelineAsset,
} from './TimelineTypes';

export {
    hermiteInterpolate,
    evaluateChannel,
    evaluatePropertyTrack,
    evaluateSpineTrack,
    evaluateSpriteAnimTrack,
    evaluateAudioTrack,
    evaluateActivationTrack,
    type SpineTrackAction,
    type SpriteAnimTrackAction,
    type AudioTrackAction,
} from './TimelineEvaluator';

export {
    parseTimelineAsset,
    extractTimelineAssetPaths,
    type TimelineAssetPaths,
} from './TimelineLoader';

export {
    TimelineInstance,
    advanceTimeline,
    applyWrapMode,
    type PropertyTrackResult,
    type SpineTrackState,
    type SpriteAnimTrackState,
    type AudioTrackState,
    type ActivationTrackState,
} from './TimelineSystem';

export {
    TimelineControl,
    getTimelineInstance,
    setTimelineInstance,
    removeTimelineInstance,
    clearTimelineInstances,
} from './TimelineControl';

export {
    TimelinePlugin,
    timelinePlugin,
    TimelinePlayer,
    type TimelinePlayerData,
    registerTimelineAsset,
    getTimelineAsset,
} from './TimelinePlugin';

export {
    setNestedProperty,
    getNestedProperty,
} from './propertyUtils';
