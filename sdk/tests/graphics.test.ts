import { describe, it, expect, vi } from 'vitest';
import { Graphics } from '../src/graphics';

vi.mock('../src/draw', () => ({
    Draw: {
        line: vi.fn(),
        rect: vi.fn(),
        rectOutline: vi.fn(),
        circle: vi.fn(),
        circleOutline: vi.fn(),
        begin: vi.fn(),
        end: vi.fn(),
        setDepthTest: vi.fn(),
    },
}));

describe('Graphics', () => {
    it('should create instance', () => {
        const g = new Graphics();
        expect(g).toBeDefined();
    });

    it('should track path state', () => {
        const g = new Graphics();
        g.lineStyle(2, { r: 1, g: 0, b: 0, a: 1 });
        g.moveTo(0, 0);
        g.lineTo(100, 100);
        g.lineTo(200, 0);
        expect(g.pathLength).toBe(3);
    });

    it('should clear path', () => {
        const g = new Graphics();
        g.moveTo(0, 0);
        g.lineTo(100, 100);
        g.clear();
        expect(g.pathLength).toBe(0);
    });

    it('should generate rect vertices', () => {
        const g = new Graphics();
        g.beginFill({ r: 1, g: 0, b: 0, a: 1 });
        g.drawRect(10, 20, 100, 50);
        g.endFill();
        expect(g.fillCommands.length).toBeGreaterThan(0);
    });

    it('should generate circle vertices', () => {
        const g = new Graphics();
        g.beginFill({ r: 0, g: 1, b: 0, a: 1 });
        g.drawCircle(50, 50, 30);
        g.endFill();
        expect(g.fillCommands.length).toBeGreaterThan(0);
    });

    it('should collect line segments', () => {
        const g = new Graphics();
        g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
        g.moveTo(0, 0);
        g.lineTo(100, 0);
        g.lineTo(100, 100);
        expect(g.lineCommands.length).toBe(2);
    });

    describe('curveTo (quadratic bezier)', () => {
        it('generates line segments from current point to end', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.moveTo(0, 0);
            g.curveTo(50, 100, 100, 0, 10);
            expect(g.lineCommands.length).toBe(10);
            const last = g.lineCommands[g.lineCommands.length - 1];
            expect(last.to.x).toBeCloseTo(100);
            expect(last.to.y).toBeCloseTo(0);
        });

        it('updates path endpoint', () => {
            const g = new Graphics();
            g.moveTo(0, 0);
            g.curveTo(50, 50, 100, 100, 5);
            expect(g.pathLength).toBe(2);
        });
    });

    describe('cubicCurveTo (cubic bezier)', () => {
        it('generates line segments', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.moveTo(0, 0);
            g.cubicCurveTo(30, 100, 70, 100, 100, 0, 10);
            expect(g.lineCommands.length).toBe(10);
            const last = g.lineCommands[g.lineCommands.length - 1];
            expect(last.to.x).toBeCloseTo(100);
            expect(last.to.y).toBeCloseTo(0);
        });

        it('midpoint lies on curve', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.moveTo(0, 0);
            g.cubicCurveTo(0, 100, 100, 100, 100, 0, 10);
            const midCmd = g.lineCommands[5];
            expect(midCmd.to.y).toBeGreaterThan(0);
        });
    });

    describe('arc', () => {
        it('draws arc segments', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.moveTo(100, 50);
            g.arc(50, 50, 50, 0, Math.PI, false, 8);
            expect(g.lineCommands.length).toBeGreaterThanOrEqual(8);
        });

        it('supports anticlockwise', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.moveTo(100, 50);
            g.arc(50, 50, 50, 0, Math.PI, true, 8);
            expect(g.lineCommands.length).toBeGreaterThanOrEqual(8);
        });
    });

    describe('drawArc', () => {
        it('is alias for arc', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.drawArc(50, 50, 30, 0, Math.PI / 2, false, 4);
            expect(g.lineCommands.length).toBe(4);
        });
    });

    describe('drawRoundRect', () => {
        it('generates line and arc commands for rounded corners', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.drawRoundRect(0, 0, 100, 60, 10);
            expect(g.lineCommands.length).toBeGreaterThan(4);
        });

        it('falls back to drawRect when radius is 0', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.drawRoundRect(0, 0, 100, 60, 0);
            expect(g.lineCommands.length).toBe(4);
        });

        it('clamps radius to half of smallest dimension', () => {
            const g = new Graphics();
            g.lineStyle(1, { r: 1, g: 1, b: 1, a: 1 });
            g.drawRoundRect(0, 0, 40, 20, 100);
            expect(g.lineCommands.length).toBeGreaterThan(4);
        });
    });
});
