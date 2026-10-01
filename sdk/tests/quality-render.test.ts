// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/render/renderer', () => ({ Renderer: {
    setViewport: vi.fn(), begin: vi.fn(), setCullingMask: vi.fn(),
    setViewId: vi.fn(), end: vi.fn(), beginFrame: vi.fn(),
} }));
import { Renderer } from '../src/render/renderer';
import { RenderPipeline, type CameraRenderParams } from '../src/render/renderPipeline';
import { QualityController } from '../src/render/quality';
import { RenderResolution } from '../src/camera/presentPlan';
import type { PostProcessAPI } from '../src/postprocess';

describe('quality present', () => {
    const params = (): CameraRenderParams => ({
        registry: { _cpp: {} as never }, viewProjection: new Float32Array(16),
        viewportPixels: { x: 200, y: 50, w: 800, h: 600 },
        clearFlags: 3, elapsed: 0, cameraEntity: 2 as never, worldHeight: 100,
    });
    const setup = (post = true) => {
        const pipeline = new RenderPipeline();
        const q = new QualityController({ mode: 'low' });
        pipeline.setQuality(q);
        const pp = { setQualityFilter: vi.fn(), getStack: () => null,
            isInitialized: () => true, resize: vi.fn(), setOutputViewport: vi.fn(),
            setPresentRequired: vi.fn(), begin: vi.fn(), end: vi.fn() };
        if (post) pipeline.setPostProcess(pp as unknown as PostProcessAPI);
        const submit = vi.spyOn(pipeline, 'submitScene').mockImplementation(() => {});
        return { pipeline, q, pp, submit };
    };
    beforeEach(() => vi.clearAllMocks());

    it('scales only scene pixels while preserving the projection and surface viewport', () => {
        const { pipeline, pp, submit } = setup();
        const p = params();
        pipeline.renderCamera(p);
        expect(pp.resize).toHaveBeenCalledWith(600, 450);
        expect(pp.setOutputViewport).toHaveBeenCalledWith(200, 50, 800, 600);
        expect(submit.mock.calls[0][1]).toBe(p.viewProjection);
        expect(p.viewportPixels).toEqual({ x: 200, y: 50, w: 800, h: 600 });
    });

    it('preserves fixed pixel policies and reports their priority', () => {
        const { pipeline, pp, q } = setup();
        pipeline.renderCamera({ ...params(), renderPolicy: RenderResolution.Design });
        expect(pp.resize).toHaveBeenCalledWith(133, 100);
        expect(q.report().limitations).toContain('fixed-render-resolution');
    });

    it('keeps authored render textures at their declared size', () => {
        const { pipeline, pp } = setup();
        pipeline.renderCamera({ ...params(), renderTarget: 7 });
        expect(pp.begin).not.toHaveBeenCalled();
        expect(pp.resize).toHaveBeenCalledWith(800, 600);
        expect(pp.setOutputViewport).toHaveBeenCalledWith(200, 50, 800, 600);
        expect(pp.setPresentRequired).toHaveBeenCalledWith(false);
        expect(Renderer.setViewport).toHaveBeenCalledWith(200, 50, 800, 600);
    });

    it('falls back to full surface size when the presentation module is absent', () => {
        const { pipeline, q } = setup(false);
        pipeline.renderCamera(params());
        expect(Renderer.setViewport).toHaveBeenCalledWith(200, 50, 800, 600);
        expect(q.report().limitations).toContain('resolution-present-unavailable');
        pipeline.renderCamera({ ...params(), renderPolicy: RenderResolution.Design });
        expect(Renderer.setViewport).toHaveBeenLastCalledWith(200, 50, 800, 600);
    });

    it('switches back to full resolution without reloading the scene', () => {
        const { pipeline, q, pp } = setup();
        pipeline.renderCamera(params());
        q.setMode('off');
        vi.clearAllMocks();
        pipeline.renderCamera(params());
        expect(pp.begin).not.toHaveBeenCalled();
        expect(pp.resize).toHaveBeenCalledWith(800, 600);
        expect(pp.setOutputViewport).toHaveBeenCalledWith(200, 50, 800, 600);
        expect(pp.setPresentRequired).toHaveBeenCalledWith(false);
        expect(Renderer.setViewport).toHaveBeenCalledWith(200, 50, 800, 600);
    });
});
