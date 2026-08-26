// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The whole render-policy change is one thing: the size the scene is
 *        drawn at and the rect it lands in stop being the same numbers. So the
 *        test asserts exactly that, on the two calls that carry them, and
 *        asserts they still AGREE under the default policy — a test that only
 *        ran the default would be measuring an inert change.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/render/renderer', () => ({
    Renderer: {
        init: vi.fn(), resize: vi.fn(), begin: vi.fn(), flush: vi.fn(), end: vi.fn(),
        submitAll: vi.fn(), setStage: vi.fn(), setClearColor: vi.fn(),
        setViewport: vi.fn(), setCullingMask: vi.fn(), updateTransforms: vi.fn(),
        beginFrame: vi.fn(),
    },
}));

import { Renderer } from '../src/render/renderer';
import { RenderPipeline } from '../src/render/renderPipeline';
import { RenderResolution } from '../src/camera/presentPlan';

/** Only the four calls this change touches; everything else a no-op. */
function fakePostProcess(hasStack: boolean) {
    return {
        getStack: vi.fn().mockReturnValue(hasStack ? {} : null),
        resize: vi.fn(),
        setOutputViewport: vi.fn(),
        begin: vi.fn(),
        end: vi.fn(),
        _applyForCamera: vi.fn(),
        _resetAfterCamera: vi.fn(),
    };
}

const VP = { x: 0, y: 0, w: 1244, h: 700 };   // an editor play panel
const DESIGN_WORLD_HEIGHT = 1080;

function run(policy: RenderResolution | undefined, hasStack: boolean) {
    const pp = fakePostProcess(hasStack);
    const pipeline = new RenderPipeline();
    pipeline.setPostProcess(pp as never);
    pipeline.renderCamera({
        registry: { _cpp: {} as never },
        viewProjection: new Float32Array(16),
        viewportPixels: VP,
        clearFlags: 3,
        elapsed: 0,
        cameraEntity: 1 as never,
        worldHeight: DESIGN_WORLD_HEIGHT,
        renderPolicy: policy,
    });
    return pp;
}

beforeEach(() => vi.clearAllMocks());

describe('renderCamera — the render size and the present rect', () => {
    it('THE CHANGE: under a render policy the two calls carry different numbers', () => {
        const pp = run(RenderResolution.Design, /*hasStack=*/false);

        // Drawn at the world height, so one world unit is one rendered pixel.
        expect(pp.resize).toHaveBeenCalledWith(expect.any(Number), DESIGN_WORLD_HEIGHT);
        // Landed on the whole panel, which is a different height entirely.
        expect(pp.setOutputViewport).toHaveBeenCalledWith(0, 0, VP.w, VP.h);

        const [, renderH] = pp.resize.mock.calls[0]!;
        const [, , , presentH] = pp.setOutputViewport.mock.calls[0]!;
        expect(renderH).not.toBe(presentH);
    });

    it('engages the chain with no effects on it — the blit that ends it IS the present', () => {
        const pp = run(RenderResolution.Design, /*hasStack=*/false);
        expect(pp.begin).toHaveBeenCalled();
        expect(pp.end).toHaveBeenCalled();
        // No stack means no per-camera effect state to apply or unwind.
        expect(pp._applyForCamera).not.toHaveBeenCalled();
        expect(pp._resetAfterCamera).not.toHaveBeenCalled();
    });

    it('draws the scene into the whole render target, not the panel rect', () => {
        run(RenderResolution.Design, false);
        expect(Renderer.setViewport).toHaveBeenCalledWith(0, 0, expect.any(Number), DESIGN_WORLD_HEIGHT);
    });

    it('...and the default policy leaves both calls agreeing, as they always did', () => {
        // The same measurement on the untouched path. Without it, the assertions
        // above could pass on a pipeline that scaled everything unconditionally.
        const pp = run(undefined, /*hasStack=*/true);
        expect(pp.resize).toHaveBeenCalledWith(VP.w, VP.h);
        expect(pp.setOutputViewport).toHaveBeenCalledWith(VP.x, VP.y, VP.w, VP.h);
        expect(Renderer.setViewport).toHaveBeenCalledWith(VP.x, VP.y, VP.w, VP.h);
    });

    it('...and with no policy and no stack the chain stays out of the frame entirely', () => {
        const pp = run(undefined, /*hasStack=*/false);
        expect(pp.begin).not.toHaveBeenCalled();
        expect(pp.resize).not.toHaveBeenCalled();
    });

    it('a camera whose viewport already matches the world height does not scale', () => {
        // Nothing to gain and a blit to pay for. `oneToOne` is what spares it.
        const pp = fakePostProcess(false);
        const pipeline = new RenderPipeline();
        pipeline.setPostProcess(pp as never);
        pipeline.renderCamera({
            registry: { _cpp: {} as never },
            viewProjection: new Float32Array(16),
            viewportPixels: { x: 0, y: 0, w: 1920, h: 1080 },
            clearFlags: 3,
            elapsed: 0,
            cameraEntity: 1 as never,
            worldHeight: 1080,
            renderPolicy: RenderResolution.Design,
        });
        expect(pp.begin).not.toHaveBeenCalled();
    });

    it('offsets the present rect by the camera viewport, so split-screen still lands right', () => {
        const pp = fakePostProcess(false);
        const pipeline = new RenderPipeline();
        pipeline.setPostProcess(pp as never);
        pipeline.renderCamera({
            registry: { _cpp: {} as never },
            viewProjection: new Float32Array(16),
            viewportPixels: { x: 960, y: 0, w: 960, h: 700 },
            clearFlags: 3,
            elapsed: 0,
            cameraEntity: 1 as never,
            worldHeight: 1080,
            renderPolicy: RenderResolution.Design,
        });
        const [x, , w] = pp.setOutputViewport.mock.calls[0]!;
        expect(x).toBe(960);
        expect(w).toBe(960);
    });
});
