import { describe, it, expect, beforeEach } from 'vitest';
import { setPlatform } from '../src/platform/base';
import { WebAudioBackend } from '../src/audio/WebAudioBackend';
import { WeChatAudioBackend } from '../src/audio/WeChatAudioBackend';
import type { PlatformAdapter } from '../src/platform/types';

function createMockPlatform(name: 'web' | 'wechat'): PlatformAdapter {
    return {
        name,
        fetch: async () => ({} as any),
        readFile: async () => new ArrayBuffer(0),
        readTextFile: async () => '',
        fileExists: async () => false,
        loadImagePixels: async () => ({ width: 0, height: 0, pixels: new Uint8Array() }),
        instantiateWasm: async () => ({} as any),
        createCanvas: () => ({} as any),
        now: () => 0,
        createImage: () => ({} as any),
        bindInputEvents: () => {},
        createAudioBackend: () => {
            if (name === 'wechat') return new WeChatAudioBackend();
            return new WebAudioBackend();
        },
    };
}

describe('PlatformAdapter.createAudioBackend', () => {
    it('should return WebAudioBackend for web platform', () => {
        const platform = createMockPlatform('web');
        setPlatform(platform);
        const backend = platform.createAudioBackend();
        expect(backend).toBeInstanceOf(WebAudioBackend);
    });

    it('should return WeChatAudioBackend for wechat platform', () => {
        const platform = createMockPlatform('wechat');
        setPlatform(platform);
        const backend = platform.createAudioBackend();
        expect(backend).toBeInstanceOf(WeChatAudioBackend);
    });

    it('should return backend with mixer=null for WeChat', () => {
        const platform = createMockPlatform('wechat');
        const backend = platform.createAudioBackend();
        expect(backend.mixer).toBeNull();
    });
});
