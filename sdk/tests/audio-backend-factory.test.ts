import { describe, it, expect, beforeEach } from 'vitest';
import { createAudioBackend } from '../src/audio/AudioBackendFactory';
import { setPlatform } from '../src/platform/base';
import { WebAudioBackend } from '../src/audio/WebAudioBackend';
import { WeChatAudioBackend } from '../src/audio/WeChatAudioBackend';

describe('AudioBackendFactory', () => {
    describe('createAudioBackend', () => {
        it('should return WebAudioBackend for web platform', () => {
            setPlatform({ name: 'web' } as any);
            const backend = createAudioBackend();
            expect(backend).toBeInstanceOf(WebAudioBackend);
        });

        it('should return WeChatAudioBackend for wechat platform', () => {
            setPlatform({ name: 'wechat' } as any);
            const backend = createAudioBackend();
            expect(backend).toBeInstanceOf(WeChatAudioBackend);
        });
    });
});
