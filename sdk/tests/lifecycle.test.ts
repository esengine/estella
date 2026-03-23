import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LifecycleManager } from '../src/lifecycle';

describe('LifecycleManager', () => {
    let manager: LifecycleManager;

    beforeEach(() => {
        manager = new LifecycleManager();
    });

    it('starts visible and focused', () => {
        expect(manager.visible).toBe(true);
        expect(manager.focused).toBe(true);
    });

    it('tracks visibility changes', () => {
        manager.setVisible_(false);
        expect(manager.visible).toBe(false);

        manager.setVisible_(true);
        expect(manager.visible).toBe(true);
    });

    it('tracks focus changes', () => {
        manager.setFocused_(false);
        expect(manager.focused).toBe(false);

        manager.setFocused_(true);
        expect(manager.focused).toBe(true);
    });

    it('does not emit duplicate visibility events', () => {
        const events: string[] = [];
        manager.on(e => events.push(e));

        manager.setVisible_(true);
        expect(events).toEqual([]);

        manager.setVisible_(false);
        expect(events).toEqual(['hide']);

        manager.setVisible_(false);
        expect(events).toEqual(['hide']);
    });

    describe('listeners', () => {
        it('on() registers and fires listener', () => {
            const events: string[] = [];
            manager.on(e => events.push(e));

            manager.emit_('show');
            manager.emit_('hide');

            expect(events).toEqual(['show', 'hide']);
        });

        it('on() returns unsubscribe function', () => {
            const events: string[] = [];
            const unsub = manager.on(e => events.push(e));

            manager.emit_('show');
            unsub();
            manager.emit_('hide');

            expect(events).toEqual(['show']);
        });

        it('off() removes listener', () => {
            const events: string[] = [];
            const listener = (e: string) => events.push(e);
            manager.on(listener as any);

            manager.emit_('pause');
            manager.off(listener as any);
            manager.emit_('resume');

            expect(events).toEqual(['pause']);
        });

        it('removeAllListeners clears everything', () => {
            const events: string[] = [];
            manager.on(e => events.push(e));
            manager.on(e => events.push(e));

            manager.removeAllListeners();
            manager.emit_('show');

            expect(events).toEqual([]);
        });

        it('catches listener errors without breaking', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const events: string[] = [];

            manager.on(() => { throw new Error('boom'); });
            manager.on(e => events.push(e));

            manager.emit_('show');

            expect(events).toEqual(['show']);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('autoPause', () => {
        it('defaults to true', () => {
            expect(manager.autoPause).toBe(true);
        });

        it('can be toggled', () => {
            manager.autoPause = false;
            expect(manager.autoPause).toBe(false);
        });
    });
});
