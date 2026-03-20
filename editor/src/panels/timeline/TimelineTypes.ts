export interface SpineClipHit {
    trackIndex: number;
    clipIndex: number;
    zone: 'body' | 'resize';
}

export interface AudioEventHit {
    trackIndex: number;
    eventIndex: number;
}

export interface ActivationRangeHit {
    trackIndex: number;
    rangeIndex: number;
    zone: 'body' | 'left' | 'right';
}

export interface MarkerHit {
    trackIndex: number;
    markerIndex: number;
}

export interface CustomEventHit {
    trackIndex: number;
    eventIndex: number;
}

export interface SpriteAnimHit {
    trackIndex: number;
}

export interface AnimFrameHit {
    trackIndex: number;
    frameIndex: number;
    zone: 'body' | 'resize';
}

export interface TimelineAssetData {
    tracks: TimelineTrackData[];
    duration: number;
}

export interface TimelineKeyframe {
    time: number;
    value: number;
    inTangent?: number;
    outTangent?: number;
    interpolation?: string;
}

export interface TimelineChannel {
    property: string;
    keyframes: TimelineKeyframe[];
}

export interface TimelineSpineClip {
    start: number;
    duration: number;
    animation: string;
}

export interface TimelineAudioEvent {
    time: number;
    clip: string;
}

export interface TimelineCustomEvent {
    time: number;
    name: string;
    payload: Record<string, unknown>;
}

export interface TimelineActivationRange {
    start: number;
    end: number;
}

export interface TimelineMarker {
    time: number;
    name: string;
}

export interface AnimFrameData {
    texture: string;
    duration?: number;
    thumbnailUrl?: string;
}

export interface TimelineTrackData {
    type: string;
    name: string;
    childPath?: string;
    component?: string;
    channels?: TimelineChannel[];
    clips?: TimelineSpineClip[];
    events?: (TimelineAudioEvent | TimelineCustomEvent)[];
    ranges?: TimelineActivationRange[];
    markers?: TimelineMarker[];
    clip?: string;
    startTime?: number;
    animFrames?: AnimFrameData[];
}

export interface KeyframeHit {
    trackIndex: number;
    channelIndex: number;
    keyframeIndex: number;
    time: number;
}

export interface TimelinePanelHost {
    get assetData(): TimelineAssetData | null;
    executeCommand(cmd: import('../../commands/Command').Command): void;
    onAssetDataChanged(): void;
    readPropertyValue(trackIndex: number, channelIndex: number): number;
}

export interface SelectedKeyframeInfo {
    trackIndex: number;
    channelIndex: number;
    keyframeIndex: number;
    time: number;
    value: number;
}

export interface SelectionSummary {
    count: number;
    single: SelectedKeyframeInfo | null;
}

export type KeyframeSelectionCallback = (summary: SelectionSummary) => void;

export type NonPropertyHit = {
    type: string;
    hit: SpineClipHit | AudioEventHit | ActivationRangeHit | MarkerHit | CustomEventHit | SpriteAnimHit | AnimFrameHit;
};

export function kfKey(trackIndex: number, channelIndex: number, keyframeIndex: number): string {
    return `${trackIndex}:${channelIndex}:${keyframeIndex}`;
}
