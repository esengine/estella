// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    TIMELINE_FORMAT_VERSION,
    playableTimeline,
    WrapMode,
    TrackType,
    InterpType,
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
    type Marker,
    type MarkerTrack,
    type CustomEvent,
    type CustomEventTrack,
    type CameraClip,
    type CameraTrack,
    type SequenceClip,
    type SequenceTrack,
    type AnimationTrack,
    type AnimationClipItem,
    type AnimationExtrapolation,
    type AnimationTrackBlend,
    type SpawnClip,
    type SpawnTrack,
    type CameraShakeItem,
    type CameraShakeTrack,
    type AnimFrame,
    type AnimFramesTrack,
    type Track,
    type TimelineAsset,
} from './TimelineTypes';

export {
    parseTimelineAsset,
    extractTimelineAssetPaths,
    type TimelineAssetPaths,
} from './TimelineLoader';

export {
    Timeline,
    TimelineAPI,
    type PlayerFlagChannel,
} from './TimelineControl';

export {
    resolveChildEntity,
    setNestedProperty,
    applyTimelineEvent,
    TimelineEventType,
} from './TimelineRuntime';

export {
    sampleTimeline,
    sampleTimelineInWorld,
    evaluateChannel,
    applyWrapMode,
    isRootPlacementChannel,
    sampleRootPlacement,
    createRootPlacement,
    type SampleWorld,
    type SampleDeps,
    type SampleOptions,
    type RootPlacement,
} from './TimelineEvaluator';

export { TimeDilation, type TimeDilationData } from './timeDilation';

export {
    resolveTimelinePath,
    boundEntity,
    isBoundPath,
    splitBoundPath,
} from './timelineBindings';

export {
    TimelineAudioVoices,
    audioClipGain,
    audioClipOffset,
    isAudioClip,
} from './timelineAudio';

export {
    sampleAnimationTracks,
    animationClipWeights,
    extrapolatedTime,
    forgetAnimationRests,
    clipLocalTime,
    type AnimationClipWeight,
} from './timelineAnimation';

export {
    playheadRuns,
    runCrosses,
    collectCustomEvents,
    collectSignals,
    TimelineEvent,
    TimelinePlayback,
    type TimelinePlaybackPayload,
    type PlayheadRun,
    type TimelineSignal,
    type TimelineEventPayload,
} from './timelineEvents';

export {
    MAX_SEQUENCE_DEPTH,
    sequenceLocalTime,
    collectSequenceLayers,
    wouldNestCycle,
    resolveShot,
    resolveActiveShot,
    type SequenceLayer,
    type SequenceLookup,
    type ShotState,
    type ActiveShot,
} from './timelineSequences';

export {
    serializeTimelineAsset,
    serializeTimelineToJson,
} from './TimelineSerializer';

export {
    parseAnimationClip,
} from './AnimationClip';

export {
    advanceTimelineTS,
    detectTimelineEvents,
    createTimelineState,
    applyPlayerFlags,
    latchPlayerFinish,
    type TimelinePlayerFlags,
    type TimelineState,
    type FiredEvent,
    type AdvanceContext,
} from './TimelineDrive';

export {
    TimelinePlugin,
    timelinePlugin,
    timelineSignalType,
    type TimelineSignalEventData,
} from './TimelinePlugin';

export {
    TimelinePlayer,
    resolveWrapMode,
    type TimelinePlayerData,
} from './TimelinePlayerComponent';


export {
    TIMELINE_MOTION,
    createTimelineMotionDriver,
    type TimelineMotionEffects,
} from './timelineMotion';
export { TimelineSpawns, spawnClipActive, type TimelineSpawner, type PreparedTimelineSpawn } from './timelineSpawns';
export { sampleTimelineSpriteFrames, projectTimelineSpriteFrame, type TimelineSpriteFrame, type TimelineFrameImage } from './timelineSpriteFrames';
export { timelineShakenPOV, TIMELINE_VIEW_SHAKE, type TimelineShakeDeps } from './timelineCameraShake';
export { rootPlacementAt, clipRootTravel, composePlacement, invertPlacement, blendPlacements } from './timelineRootMotion';
