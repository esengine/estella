import { defineBuiltin } from '../../component';

export interface FanLayoutData {
    radius: number;
    maxSpreadAngle: number;
    maxCardAngle: number;
    tiltFactor: number;
    cardSpacing: number;
    direction: number;
}

export const FanLayoutDirection = {
    Up: 0,
    Down: 1,
} as const;

export const FanLayout = defineBuiltin<FanLayoutData>('FanLayout', {
    radius: 600,
    maxSpreadAngle: 30,
    maxCardAngle: 8,
    tiltFactor: 1.0,
    cardSpacing: 0,
    direction: FanLayoutDirection.Up,
});
