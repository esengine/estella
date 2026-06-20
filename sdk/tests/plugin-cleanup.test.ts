/**
 * @file    plugin-cleanup.test.ts
 * @brief   Regression net for audit A19 — Physics/Spine plugins must release
 *          their native module + world listeners on app teardown (App calls
 *          plugin.cleanup() at shutdown). Before this, `_physics_shutdown` was
 *          dead code, the spine backends were never disposed, and the
 *          world.onDespawn subscription was leaked, so re-init left a stale
 *          listener pointing at a dead manager.
 */
import { describe, expect, it, vi } from 'vitest';
import { SpineManager } from '../src/spine/SpineManager';
import { SpinePlugin } from '../src/spine/SpinePlugin';
import { PhysicsPlugin } from '../src/physics/PhysicsPlugin';

describe('SpineManager.dispose (A19)', () => {
    it('shuts down every backend and clears all state, idempotently', () => {
        const mgr = new SpineManager({} as any, new Map());
        const backendA = { shutdown: vi.fn() };
        const backendB = { shutdown: vi.fn() };
        const m = mgr as any;
        m.backends_.set('3.8', backendA);
        m.backends_.set('4.1', backendB);
        m.entityVersions_.set(1, '3.8');
        m.loadingBackends_.set('4.2', Promise.resolve(null));

        mgr.dispose();

        expect(backendA.shutdown).toHaveBeenCalledTimes(1);
        expect(backendB.shutdown).toHaveBeenCalledTimes(1);
        expect(m.backends_.size).toBe(0);
        expect(m.entityVersions_.size).toBe(0);
        expect(m.loadingBackends_.size).toBe(0);

        // Idempotent: a second dispose is a no-op, not a re-shutdown / throw.
        expect(() => mgr.dispose()).not.toThrow();
        expect(backendA.shutdown).toHaveBeenCalledTimes(1);
    });
});

describe('SpinePlugin.cleanup (A19)', () => {
    it('unsubscribes the despawn listener and disposes the spine manager', () => {
        const plugin = new SpinePlugin();
        const unsub = vi.fn();
        const manager = { dispose: vi.fn() };
        const p = plugin as any;
        p.despawnUnsub_ = unsub;
        p.spineManager_ = manager;

        plugin.cleanup();

        expect(unsub).toHaveBeenCalledTimes(1);
        expect(manager.dispose).toHaveBeenCalledTimes(1);
        expect(p.despawnUnsub_).toBeNull();

        // A second cleanup must not re-fire the (now dropped) subscription.
        plugin.cleanup();
        expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('is safe to call when build never ran (no subscription / manager)', () => {
        const plugin = new SpinePlugin();
        expect(() => plugin.cleanup()).not.toThrow();
    });
});

describe('PhysicsPlugin.cleanup (A19)', () => {
    it('shuts down the native physics world and nulls the module', () => {
        const plugin = new PhysicsPlugin('fake://physics.wasm');
        const shutdown = vi.fn();
        const p = plugin as any;
        p.module_ = { _physics_shutdown: shutdown };

        plugin.cleanup();

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(p.module_).toBeNull();

        // A second cleanup (module already released) must be a no-op.
        plugin.cleanup();
        expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it('is safe to call before the async module load completed', () => {
        const plugin = new PhysicsPlugin('fake://physics.wasm');
        expect(() => plugin.cleanup()).not.toThrow();
    });
});
