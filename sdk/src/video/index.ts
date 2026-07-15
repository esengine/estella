// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { VideoPlugin, videoPlugin } from './VideoPlugin';
export { VideoAPI, VideoPlayer, type VideoHandle, type VideoPlayOptions } from './VideoAPI';
export { Video, type VideoData } from './VideoComponents';
export type {
    PlatformVideoBackend,
    VideoStreamHandle,
    VideoStreamOptions,
} from './PlatformVideoBackend';
export { WebVideoBackend } from './WebVideoBackend';
export { NullVideoBackend } from './NullVideoBackend';
