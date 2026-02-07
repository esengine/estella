import { Renderer, type RenderTargetHandle } from './renderer';

export interface RenderTextureOptions {
    width: number;
    height: number;
    depth?: boolean;
    filter?: 'nearest' | 'linear';
}

export interface RenderTextureHandle {
    _handle: RenderTargetHandle;
    textureId: number;
    width: number;
    height: number;
}

export const RenderTexture = {
    create(options: RenderTextureOptions): RenderTextureHandle {
        const depth = options.depth ?? true;
        const linear = options.filter === 'linear';
        const flags = (depth ? 1 : 0) | (linear ? 2 : 0);

        const handle = Renderer.createRenderTarget(options.width, options.height, flags);
        const textureId = Renderer.getTargetTexture(handle);

        return {
            _handle: handle,
            textureId,
            width: options.width,
            height: options.height,
        };
    },

    release(rt: RenderTextureHandle): void {
        Renderer.releaseRenderTarget(rt._handle);
    },

    resize(rt: RenderTextureHandle, width: number, height: number): RenderTextureHandle {
        Renderer.releaseRenderTarget(rt._handle);
        return RenderTexture.create({ width, height, depth: true });
    },

    begin(rt: RenderTextureHandle, viewProjection: Float32Array): void {
        Renderer.begin(viewProjection, rt._handle);
    },

    end(): void {
        Renderer.end();
    },

    getDepthTexture(rt: RenderTextureHandle): number {
        return Renderer.getTargetDepthTexture(rt._handle);
    },
};
