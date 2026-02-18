import { defineResource } from '../resource';

export interface UICameraData {
    viewProjection: Float32Array;
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
    screenW: number;
    screenH: number;
    worldLeft: number;
    worldBottom: number;
    worldRight: number;
    worldTop: number;
    worldMouseX: number;
    worldMouseY: number;
    valid: boolean;
}

export const UICameraInfo = defineResource<UICameraData>({
    viewProjection: new Float32Array(16),
    vpX: 0, vpY: 0, vpW: 0, vpH: 0,
    screenW: 0, screenH: 0,
    worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
    worldMouseX: 0, worldMouseY: 0,
    valid: false,
}, 'UICameraInfo');
