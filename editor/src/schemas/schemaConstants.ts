import type { PropertyMeta } from '../property/PropertyEditor';

export const LAYER_MIN = -1000;
export const LAYER_MAX = 1000;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;
export const TIME_SCALE_MAX = 10;
export const SKELETON_SCALE_MIN = 0.01;
export const SKELETON_SCALE_MAX = 100;

export const FOV_MIN = 1;
export const FOV_MAX = 179;
export const TILE_SIZE_MAX = 512;
export const POLYGON_VERTICES_MAX = 8;
export const AUDIO_PITCH_MIN = 0.1;
export const AUDIO_PITCH_MAX = 3;

export const Constraints = {
    percentage:   { min: 0, max: 1, step: 0.01 },
    positiveInt:  { min: 0, step: 1 },
    angle:        { min: -360, max: 360, step: 1 },
    fontSize:     { min: FONT_SIZE_MIN, max: FONT_SIZE_MAX, step: 1 },
    layer:        { min: LAYER_MIN, max: LAYER_MAX, step: 1 },
    opacity:      { min: 0, max: 1, step: 0.05 },
    physDensity:  { min: 0, step: 0.1 },
    physFriction: { min: 0, max: 1, step: 0.01 },
    physBounce:   { min: 0, max: 1, step: 0.01 },
    fov:          { min: FOV_MIN, max: FOV_MAX, step: 1 },
    pitch:        { min: AUDIO_PITCH_MIN, max: AUDIO_PITCH_MAX, step: 0.1 },
} as const;

export function definePropertyGroup(group: string, props: Omit<PropertyMeta, 'group'>[]): PropertyMeta[] {
    return props.map(p => ({ ...p, group }) as PropertyMeta);
}
