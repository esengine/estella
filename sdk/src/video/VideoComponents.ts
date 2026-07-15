// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// The declarative Video component. It renders through its entity's Sprite (the
// system writes the live frame texture into it), so a Video needs a Sprite.
import { defineComponent } from '../component';

export interface VideoData {
    source: string;
    autoplay: boolean;
    loop: boolean;
    muted: boolean;
    volume: number;
    playbackRate: number;
    /** On first frame, size the Sprite to the video's native pixels. */
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
