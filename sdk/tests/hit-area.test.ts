import { describe, it, expect } from 'vitest';
import { HitAreaShape, pointInHitArea } from '../src/hitArea';

describe('HitArea', () => {
    describe('rect', () => {
        it('should detect point inside rect', () => {
            const area: HitAreaShape = { type: 'rect', x: 0, y: 0, width: 100, height: 50 };
            expect(pointInHitArea(50, 25, area)).toBe(true);
        });

        it('should detect point outside rect', () => {
            const area: HitAreaShape = { type: 'rect', x: 0, y: 0, width: 100, height: 50 };
            expect(pointInHitArea(150, 25, area)).toBe(false);
        });
    });

    describe('circle', () => {
        it('should detect point inside circle', () => {
            const area: HitAreaShape = { type: 'circle', cx: 50, cy: 50, radius: 30 };
            expect(pointInHitArea(50, 50, area)).toBe(true);
            expect(pointInHitArea(60, 50, area)).toBe(true);
        });

        it('should detect point outside circle', () => {
            const area: HitAreaShape = { type: 'circle', cx: 50, cy: 50, radius: 30 };
            expect(pointInHitArea(100, 100, area)).toBe(false);
        });
    });

    describe('polygon', () => {
        it('should detect point inside triangle', () => {
            const area: HitAreaShape = {
                type: 'polygon',
                points: [0, 0, 100, 0, 50, 80],
            };
            expect(pointInHitArea(50, 30, area)).toBe(true);
        });

        it('should detect point outside triangle', () => {
            const area: HitAreaShape = {
                type: 'polygon',
                points: [0, 0, 100, 0, 50, 80],
            };
            expect(pointInHitArea(200, 200, area)).toBe(false);
        });
    });
});
