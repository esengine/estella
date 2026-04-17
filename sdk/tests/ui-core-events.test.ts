/**
 * Unit tests for sdk/src/ui2/core/events.ts.
 * Pure TS; no WASM / World required.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UIEventQueue, UIEventType, type UIEvent } from '../src/ui/core/events';
import type { Entity } from '../src/types';

const E1 = 1 as Entity;
const E2 = 2 as Entity;
const E3 = 3 as Entity;

describe('UIEventQueue', () => {
    let q: UIEventQueue;

    beforeEach(() => {
        q = new UIEventQueue();
    });

    describe('subscribe + emit', () => {
        it('fires entity-scoped handler synchronously on emit', () => {
            const fn = vi.fn();
            q.on(E1, UIEventType.Click, fn);
            q.emit(E1, UIEventType.Click);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('does not fire handlers for a different entity', () => {
            const fn = vi.fn();
            q.on(E1, UIEventType.Click, fn);
            q.emit(E2, UIEventType.Click);
            expect(fn).not.toHaveBeenCalled();
        });

        it('fires global handler for any entity', () => {
            const fn = vi.fn();
            q.on(UIEventType.Click, fn);
            q.emit(E1, UIEventType.Click);
            q.emit(E2, UIEventType.Click);
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('supports arbitrary string event types', () => {
            const fn = vi.fn();
            q.on(E1, 'item_selected', fn);
            q.emit(E1, 'item_selected', { index: 3 });
            expect(fn).toHaveBeenCalledOnce();
            expect(fn.mock.calls[0][0].data).toEqual({ index: 3 });
        });
    });

    describe('unsubscribe', () => {
        it('entity unsubscribe stops handler from firing', () => {
            const fn = vi.fn();
            const off = q.on(E1, UIEventType.Click, fn);
            off();
            q.emit(E1, UIEventType.Click);
            expect(fn).not.toHaveBeenCalled();
        });

        it('global unsubscribe stops handler from firing', () => {
            const fn = vi.fn();
            const off = q.on(UIEventType.Click, fn);
            off();
            q.emit(E1, UIEventType.Click);
            expect(fn).not.toHaveBeenCalled();
        });

        it('is idempotent (double unsubscribe safe)', () => {
            const fn = vi.fn();
            const off = q.on(E1, UIEventType.Click, fn);
            off();
            off();
            q.emit(E1, UIEventType.Click);
            expect(fn).not.toHaveBeenCalled();
        });

        it('does not affect other handlers for same event', () => {
            const a = vi.fn();
            const b = vi.fn();
            const offA = q.on(E1, UIEventType.Click, a);
            q.on(E1, UIEventType.Click, b);
            offA();
            q.emit(E1, UIEventType.Click);
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledOnce();
        });
    });

    describe('removeAll', () => {
        it('removes entity-specific handlers but keeps globals', () => {
            const entityFn = vi.fn();
            const globalFn = vi.fn();
            q.on(E1, UIEventType.Click, entityFn);
            q.on(UIEventType.Click, globalFn);

            q.removeAll(E1);
            q.emit(E1, UIEventType.Click);

            expect(entityFn).not.toHaveBeenCalled();
            expect(globalFn).toHaveBeenCalledOnce();
        });
    });

    describe('drain / query', () => {
        it('drain returns queued events and clears the queue', () => {
            q.emit(E1, UIEventType.Click);
            q.emit(E2, UIEventType.HoverEnter);

            const first = q.drain();
            expect(first).toHaveLength(2);
            expect(first[0].type).toBe(UIEventType.Click);
            expect(first[1].type).toBe(UIEventType.HoverEnter);

            const second = q.drain();
            expect(second).toHaveLength(0);
        });

        it('query filters by type without draining', () => {
            q.emit(E1, UIEventType.Click);
            q.emit(E2, UIEventType.HoverEnter);
            q.emit(E3, UIEventType.Click);

            const clicks = q.query(UIEventType.Click);
            expect(clicks).toHaveLength(2);

            // Queue not consumed
            expect(q.drain()).toHaveLength(3);
        });
    });

    describe('bubbling', () => {
        it('emitBubbled fires ancestor handler and reports target = original entity', () => {
            const parentFn = vi.fn();
            q.on(E2, UIEventType.Click, parentFn);

            const root = q.emit(E1, UIEventType.Click);
            q.emitBubbled(E2, root);

            expect(parentFn).toHaveBeenCalledOnce();
            const evt = parentFn.mock.calls[0][0] as UIEvent;
            expect(evt.target).toBe(E1);
            expect(evt.currentTarget).toBe(E2);
        });

        it('stopPropagation on bubbled event halts further bubbling', () => {
            const b1 = vi.fn((e: UIEvent) => e.stopPropagation());
            const b2 = vi.fn();
            q.on(E2, UIEventType.Click, b1);
            q.on(E3, UIEventType.Click, b2);

            const root = q.emit(E1, UIEventType.Click);
            const afterB1 = q.emitBubbled(E2, root);

            // Respect the intended behavior: caller checks propagationStopped
            expect(afterB1.propagationStopped).toBe(true);
            expect(root.propagationStopped).toBe(true);

            // Caller (e.g. plugin walking the parent chain) would stop here.
            // If they mistakenly call emitBubbled again, handler is NOT invoked.
            q.emitBubbled(E3, root);
            expect(b2).not.toHaveBeenCalled();
        });

        it('preventDefault propagates to the root event', () => {
            q.on(E2, UIEventType.Click, (e) => e.preventDefault());
            const root = q.emit(E1, UIEventType.Click);
            q.emitBubbled(E2, root);
            expect(root.defaultPrevented).toBe(true);
        });
    });

    describe('reentry safety', () => {
        it('does not infinite-loop when a handler re-emits the same event on the same entity', () => {
            let nested = 0;
            q.on(E1, 'ping', () => {
                nested++;
                if (nested < 100) q.emit(E1, 'ping');   // try to recurse
            });
            q.emit(E1, 'ping');
            expect(nested).toBe(1);   // reentry blocked
        });

        it('allows handler to emit a different event on the same entity', () => {
            const b = vi.fn();
            q.on(E1, 'a', () => q.emit(E1, 'b'));
            q.on(E1, 'b', b);

            q.emit(E1, 'a');
            expect(b).toHaveBeenCalledOnce();
        });
    });

    describe('error handling', () => {
        it('handler throw does not abort dispatch to peer handlers', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const peer = vi.fn();
            q.on(E1, UIEventType.Click, () => { throw new Error('boom'); });
            q.on(E1, UIEventType.Click, peer);

            q.emit(E1, UIEventType.Click);
            expect(peer).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('clear', () => {
        it('removes handlers and pending events', () => {
            const fn = vi.fn();
            q.on(E1, UIEventType.Click, fn);
            q.emit(E1, UIEventType.Click);
            expect(fn).toHaveBeenCalledOnce();
            expect(q.query(UIEventType.Click)).toHaveLength(1);

            q.clear();
            expect(q.query(UIEventType.Click)).toHaveLength(0);   // pending purged

            q.emit(E1, UIEventType.Click);
            expect(fn).toHaveBeenCalledOnce();                    // handler gone
        });
    });
});
