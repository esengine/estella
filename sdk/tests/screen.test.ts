import { describe, it, expect, vi } from 'vitest';
import { ScreenInfo, ScreenOrientation } from '../src/screen';

describe('ScreenInfo', () => {
    it('should detect portrait orientation', () => {
        const screen = new ScreenInfo();
        screen.update(750, 1334, 2);
        expect(screen.orientation).toBe(ScreenOrientation.Portrait);
    });

    it('should detect landscape orientation', () => {
        const screen = new ScreenInfo();
        screen.update(1920, 1080, 1);
        expect(screen.orientation).toBe(ScreenOrientation.Landscape);
    });

    it('should report dimensions', () => {
        const screen = new ScreenInfo();
        screen.update(800, 600, 2);
        expect(screen.width).toBe(800);
        expect(screen.height).toBe(600);
        expect(screen.dpr).toBe(2);
    });

    it('should fire orientation change callback', () => {
        const screen = new ScreenInfo();
        const onChange = vi.fn();
        screen.onOrientationChange = onChange;

        screen.update(750, 1334, 2);
        expect(onChange).not.toHaveBeenCalled();

        screen.update(1334, 750, 2);
        expect(onChange).toHaveBeenCalledWith(ScreenOrientation.Landscape);
    });

    it('should not fire if orientation unchanged', () => {
        const screen = new ScreenInfo();
        const onChange = vi.fn();

        screen.update(800, 600, 1);
        screen.onOrientationChange = onChange;

        screen.update(1024, 768, 1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('should fire resize callback', () => {
        const screen = new ScreenInfo();
        const onResize = vi.fn();
        screen.onResize = onResize;

        screen.update(800, 600, 1);
        expect(onResize).toHaveBeenCalledWith(800, 600);
    });

    it('should treat square as portrait', () => {
        const screen = new ScreenInfo();
        screen.update(500, 500, 1);
        expect(screen.orientation).toBe(ScreenOrientation.Portrait);
    });
});
