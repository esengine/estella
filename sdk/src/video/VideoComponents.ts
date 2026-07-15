// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    video/VideoComponents.ts
 * @brief   The declarative `Video` component — the editor/designer face of the
 *          video system, mirroring how `AudioSource` fronts the audio API.
 *
 * A `Video` renders through its entity's `Sprite`: the video system decodes the
 * source into a live texture and writes that handle (and, when `fitSize`, the
 * native pixel size) into the sibling Sprite each frame. So a video is "a Sprite
 * whose texture is alive" and inherits all of Sprite's rendering — layer, tint,
 * material, lighting, flip, blend — for free. Add a `Sprite` alongside `Video`
 * (the editor's add-component does this automatically); without one the system
 * warns once and draws nothing.
 */
import { defineComponent } from '../component';

export interface VideoData {
    /** Project-relative path / asset ref of the video (.mp4/.webm). */
    source: string;
    /** Begin playing as soon as the source is ready. */
    autoplay: boolean;
    loop: boolean;
    muted: boolean;
    /** Volume of the video's own audio track, 0..1. */
    volume: number;
    playbackRate: number;
    /** On first ready frame, drive the sibling Sprite's `size` to the video's
     *  native pixel dimensions. Off = keep the Sprite's authored size (stretch). */
    fitSize: boolean;
    enabled: boolean;
}

export const Video = defineComponent<VideoData>('Video', {
    source: '',
    autoplay: true,
    loop: true,
    muted: true,
    volume: 1.0,
    playbackRate: 1.0,
    fitSize: true,
    enabled: true,
}, {
    assetFields: [{ field: 'source', type: 'video' }],
});
