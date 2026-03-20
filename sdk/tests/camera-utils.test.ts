import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CameraUtils, initCameraAPI, shutdownCameraAPI } from '../src/camera/Camera';

const mockUICameraData = {
    viewProjection: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]),
    vpX: 0,
    vpY: 0,
    vpW: 800,
    vpH: 600,
    screenW: 800,
    screenH: 600,
    worldLeft: -400,
    worldRight: 400,
    worldBottom: -300,
    worldTop: 300,
    worldMouseX: 50,
    worldMouseY: -25,
    valid: true,
};

function createMockApp(cameraData = mockUICameraData) {
    return {
        getResource: vi.fn(() => cameraData),
    } as any;
}

describe('CameraUtils', () => {
    afterEach(() => {
        shutdownCameraAPI();
    });

    it('should return null when not initialized', () => {
        expect(CameraUtils.screenToWorld(400, 300)).toBeNull();
        expect(CameraUtils.worldToScreen(0, 0)).toBeNull();
        expect(CameraUtils.getWorldMousePosition()).toBeNull();
        expect(CameraUtils.getWorldBounds()).toBeNull();
    });

    it('should return null when camera is invalid', () => {
        const app = createMockApp({ ...mockUICameraData, valid: false });
        initCameraAPI(app);

        expect(CameraUtils.screenToWorld(400, 300)).toBeNull();
        expect(CameraUtils.worldToScreen(0, 0)).toBeNull();
    });

    it('should convert screen center to world origin with identity VP', () => {
        initCameraAPI(createMockApp());

        const result = CameraUtils.screenToWorld(400, 300);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(0, 1);
        expect(result!.y).toBeCloseTo(0, 1);
    });

    it('should convert world origin back to screen center', () => {
        initCameraAPI(createMockApp());

        const result = CameraUtils.worldToScreen(0, 0);
        expect(result).not.toBeNull();
        expect(result!.x).toBeCloseTo(400, 0);
        expect(result!.y).toBeCloseTo(300, 0);
    });

    it('should return world mouse position', () => {
        initCameraAPI(createMockApp());

        const result = CameraUtils.getWorldMousePosition();
        expect(result).toEqual({ x: 50, y: -25 });
    });

    it('should return world bounds', () => {
        initCameraAPI(createMockApp());

        const bounds = CameraUtils.getWorldBounds();
        expect(bounds).toEqual({
            left: -400,
            right: 400,
            bottom: -300,
            top: 300,
        });
    });

    it('should return null after shutdown', () => {
        initCameraAPI(createMockApp());
        expect(CameraUtils.getWorldMousePosition()).not.toBeNull();

        shutdownCameraAPI();
        expect(CameraUtils.getWorldMousePosition()).toBeNull();
    });
});
