import { describe, it, expect, vi } from 'vitest';
import { UIEventQueue } from '../src/ui/UIEvents';
import type { UIEvent, UIEventType } from '../src/ui/UIEvents';
import type { Entity } from '../src/types';

function createQueue(): UIEventQueue {
    return new UIEventQueue();
}

describe('UIEventQueue callback API', () => {
    describe('on(entity, type, handler)', () => {
        it('should invoke handler when matching event is emitted', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(1 as Entity, 'click', handler);
            q.emit(1 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].entity).toBe(1);
            expect(handler.mock.calls[0][0].type).toBe('click');
        });

        it('should not invoke handler for different entity', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(1 as Entity, 'click', handler);
            q.emit(2 as Entity, 'click');
            expect(handler).not.toHaveBeenCalled();
        });

        it('should not invoke handler for different event type', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(1 as Entity, 'click', handler);
            q.emit(1 as Entity, 'press');
            expect(handler).not.toHaveBeenCalled();
        });

        it('should support multiple handlers on same entity+type', () => {
            const q = createQueue();
            const h1 = vi.fn();
            const h2 = vi.fn();
            q.on(1 as Entity, 'click', h1);
            q.on(1 as Entity, 'click', h2);
            q.emit(1 as Entity, 'click');
            expect(h1).toHaveBeenCalledTimes(1);
            expect(h2).toHaveBeenCalledTimes(1);
        });
    });

    describe('on(type, handler) - global', () => {
        it('should invoke handler for any entity emitting matching type', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on('click', handler);
            q.emit(1 as Entity, 'click');
            q.emit(2 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('should not invoke handler for different type', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on('click', handler);
            q.emit(1 as Entity, 'press');
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('both entity and global handlers fire', () => {
        it('should invoke entity handler then global handler', () => {
            const q = createQueue();
            const order: string[] = [];
            q.on(1 as Entity, 'click', () => order.push('entity'));
            q.on('click', () => order.push('global'));
            q.emit(1 as Entity, 'click');
            expect(order).toEqual(['entity', 'global']);
        });
    });

    describe('Unsubscribe', () => {
        it('should stop invoking handler after unsubscribe', () => {
            const q = createQueue();
            const handler = vi.fn();
            const unsub = q.on(1 as Entity, 'click', handler);
            q.emit(1 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(1);

            unsub();
            q.emit(1 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should stop invoking global handler after unsubscribe', () => {
            const q = createQueue();
            const handler = vi.fn();
            const unsub = q.on('click', handler);
            q.emit(1 as Entity, 'click');
            unsub();
            q.emit(1 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('should be safe to call unsubscribe multiple times', () => {
            const q = createQueue();
            const handler = vi.fn();
            const unsub = q.on(1 as Entity, 'click', handler);
            unsub();
            unsub();
            q.emit(1 as Entity, 'click');
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('removeAll', () => {
        it('should remove all handlers for an entity', () => {
            const q = createQueue();
            const h1 = vi.fn();
            const h2 = vi.fn();
            q.on(1 as Entity, 'click', h1);
            q.on(1 as Entity, 'press', h2);
            q.removeAll(1 as Entity);
            q.emit(1 as Entity, 'click');
            q.emit(1 as Entity, 'press');
            expect(h1).not.toHaveBeenCalled();
            expect(h2).not.toHaveBeenCalled();
        });

        it('should not affect other entities', () => {
            const q = createQueue();
            const h1 = vi.fn();
            const h2 = vi.fn();
            q.on(1 as Entity, 'click', h1);
            q.on(2 as Entity, 'click', h2);
            q.removeAll(1 as Entity);
            q.emit(2 as Entity, 'click');
            expect(h2).toHaveBeenCalledTimes(1);
        });
    });

    describe('emitBubbled dispatches to handlers', () => {
        it('should dispatch to handlers registered on the bubbled entity', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(10 as Entity, 'click', handler);
            const shared = q.emit(5 as Entity, 'click');
            q.emitBubbled(10 as Entity, 'click', 5 as Entity, shared);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].entity).toBe(10);
            expect(handler.mock.calls[0][0].target).toBe(5);
        });
    });

    describe('exception handling', () => {
        it('should not stop other handlers when one throws', () => {
            const q = createQueue();
            const h1 = vi.fn(() => { throw new Error('boom'); });
            const h2 = vi.fn();
            q.on(1 as Entity, 'click', h1);
            q.on(1 as Entity, 'click', h2);

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            q.emit(1 as Entity, 'click');
            expect(h2).toHaveBeenCalledTimes(1);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('should not stop global handlers when entity handler throws', () => {
            const q = createQueue();
            const h1 = vi.fn(() => { throw new Error('boom'); });
            const h2 = vi.fn();
            q.on(1 as Entity, 'click', h1);
            q.on('click', h2);

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            q.emit(1 as Entity, 'click');
            expect(h2).toHaveBeenCalledTimes(1);
            consoleSpy.mockRestore();
        });
    });

    describe('reentrant dispatch protection', () => {
        it('should prevent same entity+type from recursively dispatching', () => {
            const q = createQueue();
            let count = 0;
            q.on(1 as Entity, 'click', () => {
                count++;
                q.emit(1 as Entity, 'click');
            });
            q.emit(1 as Entity, 'click');
            expect(count).toBe(1);
        });

        it('should allow different entity+type chains', () => {
            const q = createQueue();
            const order: string[] = [];
            q.on(1 as Entity, 'click', () => {
                order.push('A.click');
                q.emit(2 as Entity, 'focus');
            });
            q.on(2 as Entity, 'focus', () => {
                order.push('B.focus');
            });
            q.emit(1 as Entity, 'click');
            expect(order).toEqual(['A.click', 'B.focus']);
        });

        it('should still enqueue event even when dispatch is skipped', () => {
            const q = createQueue();
            q.on(1 as Entity, 'click', () => {
                q.emit(1 as Entity, 'click');
            });
            q.emit(1 as Entity, 'click');
            expect(q.hasEvent(1 as Entity, 'click')).toBe(true);
        });
    });

    describe('drain cleans up invalid entities', () => {
        it('should remove handlers for invalid entities during drain', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(1 as Entity, 'click', handler);
            q.setEntityValidator((e) => e !== (1 as Entity));
            q.drain();
            q.emit(1 as Entity, 'click');
            expect(handler).not.toHaveBeenCalled();
        });

        it('should keep handlers for valid entities', () => {
            const q = createQueue();
            const handler = vi.fn();
            q.on(1 as Entity, 'click', handler);
            q.setEntityValidator(() => true);
            q.drain();
            q.emit(1 as Entity, 'click');
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('existing API unchanged', () => {
        it('emit still queues events for hasEvent/query', () => {
            const q = createQueue();
            q.emit(1 as Entity, 'click');
            expect(q.hasEvent(1 as Entity, 'click')).toBe(true);
            expect(q.query('click')).toHaveLength(1);
        });

        it('drain clears the event queue', () => {
            const q = createQueue();
            q.emit(1 as Entity, 'click');
            const drained = q.drain();
            expect(drained).toHaveLength(1);
            expect(q.hasEvent(1 as Entity, 'click')).toBe(false);
        });
    });

    describe('unsubscribe during dispatch is safe', () => {
        it('should not skip handlers when earlier handler unsubscribes', () => {
            const q = createQueue();
            const h2 = vi.fn();
            const unsub = q.on(1 as Entity, 'click', () => { unsub(); });
            q.on(1 as Entity, 'click', h2);
            q.emit(1 as Entity, 'click');
            expect(h2).toHaveBeenCalledTimes(1);
        });
    });
});
