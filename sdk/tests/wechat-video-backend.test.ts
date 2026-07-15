// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WeChatVideoBackend } from '../src/video/WeChatVideoBackend';

function createMockDecoder(getFrameData: () => unknown) {
    return {
        start: vi.fn().mockResolvedValue(undefined),
        getFrameData: vi.fn().mockImplementation(getFrameData),
        seek: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    };
}

describe('WeChatVideoBackend', () => {
    let backend: WeChatVideoBackend;
    let decoder: ReturnType<typeof createMockDecoder>;

    beforeEach(() => {
        decoder = createMockDecoder(() => null);
        (globalThis as any).wx = { createVideoDecoder: vi.fn(() => decoder) };
        backend = new WeChatVideoBackend();
    });

    afterEach(() => {
        delete (globalThis as any).wx;
    });

    it('is named WeChat and starts the decoder in PTS mode', () => {
        backend.createStream('clip.mp4', { autoplay: true, muted: true });
        expect(backend.name).toBe('WeChat');
        expect((globalThis as any).wx.createVideoDecoder).toHaveBeenCalled();
        expect(decoder.start).toHaveBeenCalledWith({ source: 'clip.mp4', mode: 0 });
    });

    // Regression: getFrameData is typed non-null but returns null on-device until
    // a frame decodes — pump must not crash the whole VideoUpdateSystem.
    it('pump tolerates getFrameData() returning null', () => {
        const handle = backend.createStream('clip.mp4', { autoplay: true, muted: true });
        expect(() => handle.pump({} as never)).not.toThrow();
        expect(handle.textureHandle).toBe(0);
        expect(handle.isReady).toBe(false);
    });

    it('pump tolerates an empty (not-yet-decoded) frame', () => {
        decoder.getFrameData.mockReturnValue({ data: new ArrayBuffer(0), width: 0, height: 0, pkPts: 0, pkDts: 0 });
        const handle = backend.createStream('clip.mp4', { autoplay: true, muted: true });
        expect(() => handle.pump({} as never)).not.toThrow();
        expect(handle.textureHandle).toBe(0);
    });
});
