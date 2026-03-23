import { RenderTexture, type RenderTextureHandle } from './renderTexture';

export interface BitmapCache {
    textureId: number;
    width: number;
    height: number;
    valid: boolean;
    _rt: RenderTextureHandle | null;
}

export const CacheBitmap = {
    create(width: number, height: number): BitmapCache {
        const rt = RenderTexture.create({ width, height, depth: false, filter: 'linear' });
        return {
            textureId: rt.textureId,
            width,
            height,
            valid: true,
            _rt: rt,
        };
    },

    release(cache: BitmapCache): void {
        if (cache._rt) {
            RenderTexture.release(cache._rt);
            cache._rt = null;
        }
        cache.textureId = 0;
        cache.valid = false;
    },

    beginDraw(cache: BitmapCache, viewProjection: Float32Array): void {
        if (!cache._rt || !cache.valid) return;
        RenderTexture.begin(cache._rt, viewProjection);
    },

    endDraw(): void {
        RenderTexture.end();
    },

    resize(cache: BitmapCache, width: number, height: number): void {
        if (cache._rt) {
            const newRt = RenderTexture.resize(cache._rt, width, height);
            cache._rt = newRt;
            cache.textureId = newRt.textureId;
            cache.width = width;
            cache.height = height;
        }
    },
};
