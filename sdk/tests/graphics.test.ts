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
});
