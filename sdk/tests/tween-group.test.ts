import { describe, it, expect, vi } from 'vitest';
import { TweenGroup, TweenSequence, TweenCompositionManager } from '../src/animation/TweenGroup';
import { TweenState } from '../src/animation/TweenTypes';

function mockTween(doneAfter: number) {
    let elapsed = 0;
    let state: TweenState = TweenState.Running;
    return {
        get state() { return state; },
        pause() { state = TweenState.Paused; },
        resume() { state = TweenState.Running; },
        cancel() { state = TweenState.Cancelled; },
        tick(dt: number) {
            if (state !== TweenState.Running) return;
            elapsed += dt;
            if (elapsed >= doneAfter) state = TweenState.Completed;
        },
    };
}

describe('TweenGroup (parallel)', () => {
    it('reports Running when any tween is running', () => {
        const a = mockTween(1);
        const b = mockTween(2);
        const group = new TweenGroup([a, b]);
        expect(group.state).toBe(TweenState.Running);
    });

    it('reports Completed when all tweens complete', () => {
        const a = mockTween(1);
        const b = mockTween(1);
        a.tick(1);
        b.tick(1);
        const group = new TweenGroup([a, b]);
        expect(group.state).toBe(TweenState.Completed);
    });

    it('fires onComplete callback', () => {
        const a = mockTween(0);
        a.tick(1);
        const group = new TweenGroup([a]);
        const cb = vi.fn();
        group.onComplete(cb);
        group.checkComplete();
        expect(cb).toHaveBeenCalled();
    });

    it('fires onComplete only once', () => {
        const a = mockTween(0);
        a.tick(1);
        const group = new TweenGroup([a]);
        const cb = vi.fn();
        group.onComplete(cb);
        group.checkComplete();
        group.checkComplete();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('pause/resume all tweens', () => {
        const a = mockTween(1);
        const b = mockTween(1);
        const group = new TweenGroup([a, b]);
        group.pause();
        expect(a.state).toBe(TweenState.Paused);
        expect(b.state).toBe(TweenState.Paused);
        group.resume();
        expect(a.state).toBe(TweenState.Running);
        expect(b.state).toBe(TweenState.Running);
    });

    it('cancel all tweens', () => {
        const a = mockTween(1);
        const b = mockTween(1);
        const group = new TweenGroup([a, b]);
        group.cancel();
        expect(a.state).toBe(TweenState.Cancelled);
        expect(b.state).toBe(TweenState.Cancelled);
    });
});

describe('TweenSequence', () => {
    it('starts first factory immediately', () => {
        let started = 0;
        const seq = new TweenSequence([
            () => { started++; return mockTween(1); },
            () => { started++; return mockTween(1); },
        ]);
        expect(started).toBe(1);
    });

    it('advances to next when current completes', () => {
        const tweens: ReturnType<typeof mockTween>[] = [];
        const seq = new TweenSequence([
            () => { const t = mockTween(1); tweens.push(t); return t; },
            () => { const t = mockTween(1); tweens.push(t); return t; },
        ]);
        tweens[0].tick(1);
        seq.checkComplete();
        expect(tweens.length).toBe(2);
    });

    it('reports Completed when all steps done', () => {
        const tweens: ReturnType<typeof mockTween>[] = [];
        const seq = new TweenSequence([
            () => { const t = mockTween(0); t.tick(1); tweens.push(t); return t; },
        ]);
        seq.checkComplete();
        expect(seq.state).toBe(TweenState.Completed);
    });

    it('fires onComplete callback', () => {
        const cb = vi.fn();
        const seq = new TweenSequence([
            () => { const t = mockTween(0); t.tick(1); return t; },
        ]);
        seq.onComplete(cb);
        seq.checkComplete();
        expect(cb).toHaveBeenCalled();
    });

    it('cancel stops execution', () => {
        const seq = new TweenSequence([
            () => mockTween(1),
            () => mockTween(1),
        ]);
        seq.cancel();
        expect(seq.state).toBe(TweenState.Cancelled);
    });

    it('empty sequence completes immediately', () => {
        const seq = new TweenSequence([]);
        expect(seq.state).toBe(TweenState.Completed);
    });
});

describe('TweenCompositionManager', () => {
    it('add() tracks a group', () => {
        const mgr = new TweenCompositionManager();
        mgr.add(new TweenGroup([mockTween(1)]));
        expect(mgr.activeCount).toBe(1);
    });

    it('add() tracks a sequence', () => {
        const mgr = new TweenCompositionManager();
        mgr.add(new TweenSequence([() => mockTween(1)]));
        expect(mgr.activeCount).toBe(1);
    });

    it('update() drops completed items', () => {
        const mgr = new TweenCompositionManager();
        const a = mockTween(0);
        a.tick(1);
        const group = new TweenGroup([a]);
        mgr.add(group);
        expect(mgr.activeCount).toBe(1);
        mgr.update();
        expect(mgr.activeCount).toBe(0);
    });

    it('clear() empties the set', () => {
        const mgr = new TweenCompositionManager();
        mgr.add(new TweenGroup([mockTween(1)]));
        mgr.add(new TweenSequence([() => mockTween(1)]));
        mgr.clear();
        expect(mgr.activeCount).toBe(0);
    });
});
