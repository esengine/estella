import { describe, it, expect, beforeEach } from 'vitest';
import { TimerManager } from '../src/timer';

describe('TimerManager', () => {
    let manager: TimerManager;

    beforeEach(() => {
        manager = new TimerManager();
    });

    describe('delay', () => {
        it('fires callback after specified time', () => {
            let fired = false;
            manager.delay(1.0, () => { fired = true; });

            manager.tick(0.5);
            expect(fired).toBe(false);

            manager.tick(0.5);
            expect(fired).toBe(true);
        });

        it('auto-removes after firing', () => {
            manager.delay(0.5, () => {});
            expect(manager.activeCount).toBe(1);

            manager.tick(0.6);
            expect(manager.activeCount).toBe(0);
        });

        it('passes TimerHandle to callback', () => {
            let receivedId = -1;
            const handle = manager.delay(0.1, (t) => { receivedId = t.id; });

            manager.tick(0.2);
            expect(receivedId).toBe(handle.id);
        });
    });

    describe('interval', () => {
        it('fires repeatedly', () => {
            let count = 0;
            manager.interval(0.5, () => { count++; });

            manager.tick(0.5);
            expect(count).toBe(1);

            manager.tick(0.5);
            expect(count).toBe(2);

            manager.tick(0.5);
            expect(count).toBe(3);
        });

        it('stops after maxRepeat', () => {
            let count = 0;
            manager.interval(0.5, () => { count++; }, 2);

            manager.tick(0.5);
            manager.tick(0.5);
            manager.tick(0.5);

            expect(count).toBe(2);
            expect(manager.activeCount).toBe(0);
        });
    });

    describe('TimerHandle', () => {
        it('pause and resume', () => {
            let fired = false;
            const handle = manager.delay(1.0, () => { fired = true; });

            manager.tick(0.5);
            handle.pause();

            manager.tick(1.0);
            expect(fired).toBe(false);

            handle.resume();
            manager.tick(0.5);
            expect(fired).toBe(true);
        });

        it('cancel removes timer', () => {
            const handle = manager.delay(1.0, () => {});
            expect(handle.isActive).toBe(true);

            handle.cancel();
            expect(handle.isActive).toBe(false);
            expect(manager.activeCount).toBe(0);
        });

        it('reset restarts elapsed time', () => {
            let count = 0;
            const handle = manager.interval(1.0, () => { count++; });

            manager.tick(0.9);
            handle.reset();

            manager.tick(0.9);
            expect(count).toBe(0);

            manager.tick(0.2);
            expect(count).toBe(1);
        });

        it('tracks elapsed time', () => {
            const handle = manager.delay(2.0, () => {});

            manager.tick(0.5);
            expect(handle.elapsed).toBeCloseTo(0.5);

            manager.tick(0.3);
            expect(handle.elapsed).toBeCloseTo(0.8);
        });

        it('tracks repeatCount', () => {
            const handle = manager.interval(0.5, () => {});

            manager.tick(0.5);
            expect(handle.repeatCount).toBe(1);

            manager.tick(0.5);
            expect(handle.repeatCount).toBe(2);
        });
    });

    describe('timeScale', () => {
        it('scales timer progression', () => {
            let fired = false;
            manager.delay(1.0, () => { fired = true; });

            manager.timeScale = 2.0;
            manager.tick(0.5);
            expect(fired).toBe(true);
        });

        it('zero timeScale freezes timers', () => {
            let fired = false;
            manager.delay(1.0, () => { fired = true; });

            manager.timeScale = 0;
            manager.tick(10.0);
            expect(fired).toBe(false);
        });
    });

    describe('cancelAll', () => {
        it('removes all timers', () => {
            manager.delay(1.0, () => {});
            manager.delay(2.0, () => {});
            manager.interval(0.5, () => {});

            expect(manager.activeCount).toBe(3);
            manager.cancelAll();
            expect(manager.activeCount).toBe(0);
        });
    });
});
