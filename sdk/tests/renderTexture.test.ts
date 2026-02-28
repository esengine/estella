import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/renderer', () => ({
    Renderer: {
        createRenderTarget: vi.fn().mockReturnValue(1),
        releaseRenderTarget: vi.fn(),
        getTargetTexture: vi.fn().mockReturnValue(100),
        getTargetDepthTexture: vi.fn().mockReturnValue(200),
        begin: vi.fn(),
        end: vi.fn(),
    },
}));

import { RenderTexture } from '../src/renderTexture';
import { Renderer } from '../src/renderer';

describe('RenderTexture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (Renderer.createRenderTarget as ReturnType<typeof vi.fn>).mockReturnValue(1);
        (Renderer.getTargetTexture as ReturnType<typeof vi.fn>).mockReturnValue(100);
        (Renderer.getTargetDepthTexture as ReturnType<typeof vi.fn>).mockReturnValue(200);
    });

    describe('create', () => {
        it('uses depth=true by default, producing flags=1', () => {
            RenderTexture.create({ width: 256, height: 256 });
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(256, 256, 1);
        });

        it('sets flags=0 when depth=false', () => {
            RenderTexture.create({ width: 128, height: 128, depth: false });
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(128, 128, 0);
        });

        it('sets flags=3 when depth=true and filter=linear', () => {
            RenderTexture.create({ width: 64, height: 64, depth: true, filter: 'linear' });
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(64, 64, 3);
        });

        it('sets flags=2 when depth=false and filter=linear', () => {
            RenderTexture.create({ width: 64, height: 64, depth: false, filter: 'linear' });
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(64, 64, 2);
        });

        it('sets flags=1 when filter=nearest (default depth)', () => {
            RenderTexture.create({ width: 64, height: 64, filter: 'nearest' });
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(64, 64, 1);
        });

        it('returns a RenderTextureHandle with correct fields', () => {
            const rt = RenderTexture.create({ width: 512, height: 512 });
            expect(rt).toEqual({
                _handle: 1,
                textureId: 100,
                width: 512,
                height: 512,
                _depth: true,
                _filter: 'nearest',
            });
        });

        it('stores depth and filter in handle for resize', () => {
            const rt = RenderTexture.create({ width: 64, height: 64, depth: false, filter: 'linear' });
            expect(rt._depth).toBe(false);
            expect(rt._filter).toBe('linear');
        });

        it('queries textureId from the created handle', () => {
            (Renderer.createRenderTarget as ReturnType<typeof vi.fn>).mockReturnValue(42);
            RenderTexture.create({ width: 256, height: 256 });
            expect(Renderer.getTargetTexture).toHaveBeenCalledWith(42);
        });
    });

    describe('release', () => {
        it('calls releaseRenderTarget with the correct handle', () => {
            const rt = RenderTexture.create({ width: 256, height: 256 });
            RenderTexture.release(rt);
            expect(Renderer.releaseRenderTarget).toHaveBeenCalledWith(rt._handle);
        });

        it('can be called on different handles', () => {
            (Renderer.createRenderTarget as ReturnType<typeof vi.fn>).mockReturnValueOnce(10).mockReturnValueOnce(20);
            const rt1 = RenderTexture.create({ width: 64, height: 64 });
            const rt2 = RenderTexture.create({ width: 128, height: 128 });
            RenderTexture.release(rt1);
            RenderTexture.release(rt2);
            expect(Renderer.releaseRenderTarget).toHaveBeenCalledWith(10);
            expect(Renderer.releaseRenderTarget).toHaveBeenCalledWith(20);
        });
    });

    describe('resize', () => {
        it('releases old target then creates a new one', () => {
            const callOrder: string[] = [];
            (Renderer.releaseRenderTarget as ReturnType<typeof vi.fn>).mockImplementation(() => callOrder.push('release'));
            (Renderer.createRenderTarget as ReturnType<typeof vi.fn>).mockImplementation(() => {
                callOrder.push('create');
                return 2;
            });

            const rt = { _handle: 1, textureId: 100, width: 256, height: 256, _depth: true, _filter: 'nearest' as const };
            RenderTexture.resize(rt, 512, 512);

            expect(callOrder).toEqual(['release', 'create']);
            expect(Renderer.releaseRenderTarget).toHaveBeenCalledWith(1);
        });

        it('returns a new handle with updated dimensions', () => {
            (Renderer.createRenderTarget as ReturnType<typeof vi.fn>).mockReturnValue(5);
            (Renderer.getTargetTexture as ReturnType<typeof vi.fn>).mockReturnValue(500);

            const rt = { _handle: 1, textureId: 100, width: 256, height: 256, _depth: true, _filter: 'nearest' as const };
            const resized = RenderTexture.resize(rt, 1024, 768);

            expect(resized).toEqual({
                _handle: 5,
                textureId: 500,
                width: 1024,
                height: 768,
                _depth: true,
                _filter: 'nearest',
            });
        });

        it('preserves depth=false and filter=linear through resize', () => {
            const rt = { _handle: 1, textureId: 100, width: 64, height: 64, _depth: false, _filter: 'linear' as const };
            RenderTexture.resize(rt, 128, 128);
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(128, 128, 2);
        });

        it('preserves depth=true and filter=nearest through resize', () => {
            const rt = { _handle: 1, textureId: 100, width: 64, height: 64, _depth: true, _filter: 'nearest' as const };
            RenderTexture.resize(rt, 128, 128);
            expect(Renderer.createRenderTarget).toHaveBeenCalledWith(128, 128, 1);
        });
    });

    describe('begin / end', () => {
        it('calls Renderer.begin with viewProjection and handle', () => {
            const vp = new Float32Array(16);
            const rt = { _handle: 7, textureId: 100, width: 256, height: 256, _depth: true, _filter: 'nearest' as const };
            RenderTexture.begin(rt, vp);
            expect(Renderer.begin).toHaveBeenCalledWith(vp, 7);
        });

        it('calls Renderer.end', () => {
            RenderTexture.end();
            expect(Renderer.end).toHaveBeenCalled();
        });

        it('passes arguments in correct order (viewProjection first, handle second)', () => {
            const vp = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
            const rt = { _handle: 3, textureId: 100, width: 128, height: 128, _depth: true, _filter: 'nearest' as const };
            RenderTexture.begin(rt, vp);

            const call = (Renderer.begin as ReturnType<typeof vi.fn>).mock.calls[0];
            expect(call[0]).toBe(vp);
            expect(call[1]).toBe(3);
        });
    });

    describe('getDepthTexture', () => {
        it('proxies to Renderer.getTargetDepthTexture with correct handle', () => {
            const rt = { _handle: 9, textureId: 100, width: 256, height: 256, _depth: true, _filter: 'nearest' as const };
            RenderTexture.getDepthTexture(rt);
            expect(Renderer.getTargetDepthTexture).toHaveBeenCalledWith(9);
        });

        it('returns the value from Renderer', () => {
            (Renderer.getTargetDepthTexture as ReturnType<typeof vi.fn>).mockReturnValue(999);
            const rt = { _handle: 9, textureId: 100, width: 256, height: 256, _depth: true, _filter: 'nearest' as const };
            const result = RenderTexture.getDepthTexture(rt);
            expect(result).toBe(999);
        });
    });
});
