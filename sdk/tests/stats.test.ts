import { describe, it, expect, vi, afterEach } from 'vitest';
import { StatsCollector, defaultFrameStats, Stats, StatsPlugin, statsPlugin, FrameHistory, type FrameStats } from '../src/stats';
import { StatsOverlay } from '../src/stats-overlay';
import { App } from '../src/app';
import { Schedule, defineSystem, SystemRunner } from '../src/system';
import { World } from '../src/world';
import { ResourceStorage } from '../src/resource';
import * as rendererModule from '../src/renderer';

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// StatsCollector
// ============================================================================

describe('StatsCollector', () => {
    it('should start with 0 FPS and 0 frame time', () => {
        const collector = new StatsCollector();
        expect(collector.getFps()).toBe(0);
        expect(collector.getFrameTimeMs()).toBe(0);
    });

    it('should calculate FPS from delta seconds', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 10; i++) {
            collector.pushFrame(1 / 60);
        }
        expect(collector.getFps()).toBeCloseTo(60, 0);
    });

    it('should calculate frame time in milliseconds', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 10; i++) {
            collector.pushFrame(1 / 60);
        }
        expect(collector.getFrameTimeMs()).toBeCloseTo(16.67, 0);
    });

    it('should use sliding window of 60 frames', () => {
        const collector = new StatsCollector();

        for (let i = 0; i < 60; i++) {
            collector.pushFrame(1 / 30);
        }
        expect(collector.getFps()).toBeCloseTo(30, 0);

        for (let i = 0; i < 60; i++) {
            collector.pushFrame(1 / 120);
        }
        expect(collector.getFps()).toBeCloseTo(120, 0);
    });

    it('should handle zero delta gracefully', () => {
        const collector = new StatsCollector();
        collector.pushFrame(0);
        expect(collector.getFps()).toBe(0);
        expect(collector.getFrameTimeMs()).toBe(0);
    });

    it('should handle very large delta', () => {
        const collector = new StatsCollector();
        collector.pushFrame(1);
        expect(collector.getFps()).toBeCloseTo(1, 0);
        expect(collector.getFrameTimeMs()).toBeCloseTo(1000, 0);
    });

    it('should average across partial window', () => {
        const collector = new StatsCollector();
        collector.pushFrame(1 / 60);
        collector.pushFrame(1 / 60);
        collector.pushFrame(1 / 60);
        expect(collector.getFps()).toBeCloseTo(60, 0);
    });

    it('should converge to new rate after window fills', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 60; i++) collector.pushFrame(1 / 60);
        expect(collector.getFps()).toBeCloseTo(60, 0);

        for (let i = 0; i < 30; i++) collector.pushFrame(1 / 30);
        const fps = collector.getFps();
        expect(fps).toBeLessThan(60);
        expect(fps).toBeGreaterThan(30);
    });

    it('should maintain accuracy with > 100 frames pushed', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 200; i++) {
            collector.pushFrame(1 / 144);
        }
        expect(collector.getFps()).toBeCloseTo(144, 0);
        expect(collector.getFrameTimeMs()).toBeCloseTo(1000 / 144, 0);
    });

    // === Review fix: Critical #1 — negative/NaN/Infinity delta ===

    it('should clamp negative delta to 0', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 10; i++) collector.pushFrame(1 / 60);
        collector.pushFrame(-0.5);
        const fps = collector.getFps();
        expect(fps).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(fps)).toBe(true);
    });

    it('should ignore NaN delta', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 10; i++) collector.pushFrame(1 / 60);
        collector.pushFrame(NaN);
        expect(Number.isFinite(collector.getFps())).toBe(true);
        expect(collector.getFps()).toBeCloseTo(60, 0);
    });

    it('should ignore Infinity delta', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 10; i++) collector.pushFrame(1 / 60);
        collector.pushFrame(Infinity);
        expect(Number.isFinite(collector.getFps())).toBe(true);
        expect(collector.getFps()).toBeCloseTo(60, 0);
    });

    // === Review fix: Critical #2 — float drift sum_ <= 0 ===

    it('should never return negative FPS from float drift', () => {
        const collector = new StatsCollector();
        for (let i = 0; i < 200; i++) {
            collector.pushFrame(0);
        }
        expect(collector.getFps()).toBe(0);
        expect(collector.getFrameTimeMs()).toBe(0);
    });
});

// ============================================================================
// defaultFrameStats
// ============================================================================

describe('defaultFrameStats', () => {
    it('should initialize all numeric fields to 0', () => {
        const stats = defaultFrameStats();
        expect(stats.fps).toBe(0);
        expect(stats.frameTimeMs).toBe(0);
        expect(stats.entityCount).toBe(0);
        expect(stats.drawCalls).toBe(0);
        expect(stats.triangles).toBe(0);
        expect(stats.sprites).toBe(0);
        expect(stats.text).toBe(0);
        expect(stats.spine).toBe(0);
        expect(stats.meshes).toBe(0);
        expect(stats.culled).toBe(0);
    });

    it('should initialize systemTimings as empty Map', () => {
        const stats = defaultFrameStats();
        expect(stats.systemTimings).toBeInstanceOf(Map);
        expect(stats.systemTimings.size).toBe(0);
    });

    it('should return independent instances', () => {
        const a = defaultFrameStats();
        const b = defaultFrameStats();
        a.fps = 60;
        a.systemTimings.set('x', 1);
        expect(b.fps).toBe(0);
        expect(b.systemTimings.size).toBe(0);
    });
});

// ============================================================================
// App stats API
// ============================================================================

describe('App stats API', () => {
    it('should return null timings before enableStats', () => {
        const app = App.new();
        expect(app.getSystemTimings()).toBeNull();
    });

    it('should return timings map after enableStats + tick', () => {
        const app = App.new();
        app.enableStats();
        app.tick(1 / 60);
        expect(app.getSystemTimings()).toBeInstanceOf(Map);
    });

    it('should record named system timings after enableStats', () => {
        const app = App.new();
        app.enableStats();

        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => {}, { name: 'MySystem' }
        ));

        app.tick(1 / 60);

        const timings = app.getSystemTimings()!;
        expect(timings.has('MySystem')).toBe(true);
        expect(typeof timings.get('MySystem')).toBe('number');
    });

    it('should return entity count', () => {
        const app = App.new();
        expect(app.getEntityCount()).toBe(0);

        app.world.spawn();
        app.world.spawn();
        expect(app.getEntityCount()).toBe(2);
    });

    it('should chain enableStats', () => {
        const app = App.new();
        expect(app.enableStats()).toBe(app);
    });

    it('should track entity count after despawn', () => {
        const app = App.new();
        const e1 = app.world.spawn();
        app.world.spawn();
        expect(app.getEntityCount()).toBe(2);

        app.world.despawn(e1);
        expect(app.getEntityCount()).toBe(1);
    });

    // === Review fix: Medium #4 — enableStats after first tick ===

    it('should work when enableStats is called after first tick', () => {
        const app = App.new();
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => {}, { name: 'LateSystem' }
        ));
        app.tick(1 / 60);
        expect(app.getSystemTimings()).toBeNull();

        app.enableStats();
        app.tick(1 / 60);

        const timings = app.getSystemTimings();
        expect(timings).toBeInstanceOf(Map);
        expect(timings!.has('LateSystem')).toBe(true);
    });
});

// ============================================================================
// SystemRunner timing
// ============================================================================

describe('SystemRunner timing', () => {
    function createRunner() {
        const world = new World();
        const resources = new ResourceStorage();
        const runner = new SystemRunner(world, resources);
        return { world, resources, runner };
    }

    it('should have timing disabled by default', () => {
        const { runner } = createRunner();
        expect(runner.getTimings()).toBeNull();
    });

    it('should enable timing and return empty map', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);
        expect(runner.getTimings()).toBeInstanceOf(Map);
        expect(runner.getTimings()!.size).toBe(0);
    });

    it('should record system execution time when enabled', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);

        const system = defineSystem([], () => {
            let sum = 0;
            for (let i = 0; i < 1000; i++) sum += i;
        }, { name: 'TestSystem' });

        runner.run(system);

        const timings = runner.getTimings()!;
        expect(timings.has('TestSystem')).toBe(true);
        expect(timings.get('TestSystem')).toBeGreaterThanOrEqual(0);
    });

    it('should not record timing when disabled', () => {
        const { runner } = createRunner();

        const system = defineSystem([], () => {}, { name: 'NoTimingSystem' });
        runner.run(system);

        expect(runner.getTimings()).toBeNull();
    });

    it('should record timings for multiple systems', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);

        const systemA = defineSystem([], () => {}, { name: 'SystemA' });
        const systemB = defineSystem([], () => {}, { name: 'SystemB' });

        runner.run(systemA);
        runner.run(systemB);

        const timings = runner.getTimings()!;
        expect(timings.has('SystemA')).toBe(true);
        expect(timings.has('SystemB')).toBe(true);
    });

    it('should overwrite previous timing on re-run', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);

        const system = defineSystem([], () => {}, { name: 'RerunSystem' });

        runner.run(system);
        runner.run(system);

        expect(runner.getTimings()!.has('RerunSystem')).toBe(true);
        expect(typeof runner.getTimings()!.get('RerunSystem')).toBe('number');
    });

    it('should disable timing and clear data', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);

        const system = defineSystem([], () => {}, { name: 'ClearSystem' });
        runner.run(system);
        expect(runner.getTimings()!.size).toBeGreaterThan(0);

        runner.setTimingEnabled(false);
        expect(runner.getTimings()).toBeNull();
    });

    it('should still record timing when system throws', () => {
        const { runner } = createRunner();
        runner.setTimingEnabled(true);

        const system = defineSystem([], () => {
            throw new Error('boom');
        }, { name: 'ThrowSystem' });

        expect(() => runner.run(system)).toThrow('boom');
        expect(runner.getTimings()!.has('ThrowSystem')).toBe(true);
    });
});

// ============================================================================
// StatsPlugin integration
// ============================================================================

describe('StatsPlugin', () => {
    it('should register Stats resource on build', () => {
        const app = App.new();
        app.addPlugin(new StatsPlugin());
        expect(app.hasResource(Stats)).toBe(true);
    });

    it('should enable system timings on the app', () => {
        const app = App.new();
        app.addPlugin(new StatsPlugin());
        app.tick(1 / 60);
        expect(app.getSystemTimings()).not.toBeNull();
    });

    it('should have name "Stats"', () => {
        expect(new StatsPlugin().name).toBe('Stats');
    });

    // === Review fix: Critical #3 — singleton reuse ===

    it('should reset state when build is called on a new app', () => {
        const plugin = new StatsPlugin({ overlay: false });

        const app1 = App.new();
        app1.addPlugin(plugin);
        for (let i = 0; i < 30; i++) app1.tick(1 / 30);
        expect(app1.getResource(Stats).fps).toBeCloseTo(30, 0);

        plugin.cleanup();

        const app2 = App.new();
        app2.addPlugin(plugin);
        for (let i = 0; i < 10; i++) app2.tick(1 / 60);
        const fps = app2.getResource(Stats).fps;
        expect(fps).toBeCloseTo(60, 0);
    });

    describe('fps & frameTimeMs', () => {
        it('should compute fps from delta', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            for (let i = 0; i < 10; i++) app.tick(1 / 60);

            const stats = app.getResource(Stats);
            expect(stats.fps).toBeCloseTo(60, 0);
        });

        it('should compute frameTimeMs from delta', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            for (let i = 0; i < 5; i++) app.tick(1 / 60);

            const stats = app.getResource(Stats);
            expect(stats.frameTimeMs).toBeCloseTo(16.67, 0);
        });

        it('should track changing frame rate', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());

            for (let i = 0; i < 60; i++) app.tick(1 / 30);
            expect(app.getResource(Stats).fps).toBeCloseTo(30, 0);

            for (let i = 0; i < 60; i++) app.tick(1 / 120);
            expect(app.getResource(Stats).fps).toBeCloseTo(120, 0);
        });
    });

    describe('entityCount', () => {
        it('should reflect current entity count', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());

            app.world.spawn();
            app.world.spawn();
            app.world.spawn();
            app.tick(1 / 60);
            expect(app.getResource(Stats).entityCount).toBe(3);
        });

        it('should update after spawn/despawn between ticks', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());

            const e1 = app.world.spawn();
            app.world.spawn();
            app.tick(1 / 60);
            expect(app.getResource(Stats).entityCount).toBe(2);

            app.world.despawn(e1);
            app.tick(1 / 60);
            expect(app.getResource(Stats).entityCount).toBe(1);

            app.world.spawn();
            app.world.spawn();
            app.tick(1 / 60);
            expect(app.getResource(Stats).entityCount).toBe(3);
        });

        it('should be 0 with no entities', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);
            expect(app.getResource(Stats).entityCount).toBe(0);
        });
    });

    describe('systemTimings', () => {
        it('should contain named user systems', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());

            app.addSystemToSchedule(Schedule.Update, defineSystem(
                [], () => {}, { name: 'PhysicsSystem' }
            ));
            app.addSystemToSchedule(Schedule.Update, defineSystem(
                [], () => {}, { name: 'AnimationSystem' }
            ));

            app.tick(1 / 60);

            const timings = app.getResource(Stats).systemTimings;
            expect(timings.has('PhysicsSystem')).toBe(true);
            expect(timings.has('AnimationSystem')).toBe(true);
        });

        it('should not include StatsCollect own timing on first tick', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);

            const timings = app.getResource(Stats).systemTimings;
            expect(timings.has('StatsCollect')).toBe(false);
        });

        // === Review fix: Medium #8 — second tick leaks previous StatsCollect timing ===

        it('should not include StatsCollect timing on subsequent ticks either', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);
            app.tick(1 / 60);
            app.tick(1 / 60);

            const timings = app.getResource(Stats).systemTimings;
            expect(timings.has('StatsCollect')).toBe(false);
        });

        it('should record numeric timing values', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());

            app.addSystemToSchedule(Schedule.Update, defineSystem(
                [], () => { let s = 0; for (let i = 0; i < 100; i++) s += i; },
                { name: 'WorkSystem' }
            ));

            app.tick(1 / 60);

            const ms = app.getResource(Stats).systemTimings.get('WorkSystem');
            expect(typeof ms).toBe('number');
            expect(ms).toBeGreaterThanOrEqual(0);
        });

        it('should be a fresh Map copy (not shared reference)', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);

            const stats = app.getResource(Stats);
            const ref1 = stats.systemTimings;
            app.tick(1 / 60);
            const ref2 = stats.systemTimings;

            expect(ref1).not.toBe(ref2);
        });
    });

    describe('render stats from Renderer.getStats()', () => {
        it('should copy all render stats fields', () => {
            const mockStats: rendererModule.RenderStats = {
                drawCalls: 42, triangles: 8400, sprites: 100,
                text: 12, spine: 3, meshes: 5, culled: 7,
            };
            vi.spyOn(rendererModule.Renderer, 'getStats').mockReturnValue(mockStats);

            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);

            const stats = app.getResource(Stats);
            expect(stats.drawCalls).toBe(42);
            expect(stats.triangles).toBe(8400);
            expect(stats.sprites).toBe(100);
            expect(stats.text).toBe(12);
            expect(stats.spine).toBe(3);
            expect(stats.meshes).toBe(5);
            expect(stats.culled).toBe(7);
        });

        it('should update render stats each tick', () => {
            const tick1: rendererModule.RenderStats = {
                drawCalls: 10, triangles: 2000, sprites: 50,
                text: 5, spine: 1, meshes: 2, culled: 3,
            };
            const tick2: rendererModule.RenderStats = {
                drawCalls: 20, triangles: 4000, sprites: 80,
                text: 8, spine: 2, meshes: 4, culled: 6,
            };

            const spy = vi.spyOn(rendererModule.Renderer, 'getStats');
            spy.mockReturnValue(tick1);

            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);

            let stats = app.getResource(Stats);
            expect(stats.drawCalls).toBe(10);
            expect(stats.sprites).toBe(50);

            spy.mockReturnValue(tick2);
            app.tick(1 / 60);

            stats = app.getResource(Stats);
            expect(stats.drawCalls).toBe(20);
            expect(stats.triangles).toBe(4000);
            expect(stats.sprites).toBe(80);
            expect(stats.text).toBe(8);
            expect(stats.spine).toBe(2);
            expect(stats.meshes).toBe(4);
            expect(stats.culled).toBe(6);
        });

        it('should default to zeros when no WASM module', () => {
            const app = App.new();
            app.addPlugin(new StatsPlugin());
            app.tick(1 / 60);

            const stats = app.getResource(Stats);
            expect(stats.drawCalls).toBe(0);
            expect(stats.triangles).toBe(0);
            expect(stats.sprites).toBe(0);
            expect(stats.text).toBe(0);
            expect(stats.spine).toBe(0);
            expect(stats.meshes).toBe(0);
            expect(stats.culled).toBe(0);
        });
    });

    describe('StatsPluginOptions', () => {
        it('should accept overlay: false without creating DOM', () => {
            const plugin = new StatsPlugin({ overlay: false });
            const app = App.new();
            app.addPlugin(plugin);
            app.tick(1 / 60);

            const stats = app.getResource(Stats);
            expect(stats.fps).toBeGreaterThan(0);
        });

        it('should accept custom position', () => {
            const plugin = new StatsPlugin({ overlay: false, position: 'top-right' });
            const app = App.new();
            app.addPlugin(plugin);
            app.tick(1 / 60);
            expect(app.hasResource(Stats)).toBe(true);
        });
    });

    describe('cleanup', () => {
        it('should be callable without error', () => {
            const plugin = new StatsPlugin({ overlay: false });
            const app = App.new();
            app.addPlugin(plugin);
            app.tick(1 / 60);
            expect(() => plugin.cleanup()).not.toThrow();
        });

        it('should be safe to call cleanup multiple times', () => {
            const plugin = new StatsPlugin({ overlay: false });
            const app = App.new();
            app.addPlugin(plugin);
            app.tick(1 / 60);
            plugin.cleanup();
            expect(() => plugin.cleanup()).not.toThrow();
        });
    });
});

// ============================================================================
// StatsOverlay
// ============================================================================

describe('StatsOverlay', () => {
    function makeStats(overrides: Partial<FrameStats> = {}): FrameStats {
        return {
            fps: 0, frameTimeMs: 0, entityCount: 0,
            systemTimings: new Map(),
            phaseTimings: new Map(),
            drawCalls: 0, triangles: 0, sprites: 0,
            text: 0, spine: 0, meshes: 0, culled: 0,
            ...overrides,
        };
    }

    it('should create a DOM element in the container', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        expect(container.children.length).toBe(1);
        overlay.dispose();
    });

    it('should position bottom-left by default', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        const el = container.firstElementChild as HTMLElement;
        expect(el.style.cssText).toContain('bottom');
        expect(el.style.cssText).toContain('left');
        overlay.dispose();
    });

    it('should position top-right when specified', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container, 'top-right');
        const el = container.firstElementChild as HTMLElement;
        expect(el.style.cssText).toContain('top');
        expect(el.style.cssText).toContain('right');
        overlay.dispose();
    });

    it('should display FPS value in update', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ fps: 59.8 }));
        expect(container.innerHTML).toContain('59.8');
        overlay.dispose();
    });

    it('should display frameTimeMs value', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ frameTimeMs: 16.7 }));
        expect(container.innerHTML).toContain('16.7');
        overlay.dispose();
    });

    it('should display drawCalls', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ drawCalls: 42 }));
        expect(container.innerHTML).toContain('42');
        overlay.dispose();
    });

    it('should display triangles', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ triangles: 8400 }));
        expect(container.innerHTML).toContain('8400');
        overlay.dispose();
    });

    it('should display sprites and culled', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ sprites: 100, culled: 7 }));
        const html = container.innerHTML;
        expect(html).toContain('100');
        expect(html).toContain('7');
        overlay.dispose();
    });

    it('should display entityCount', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ entityCount: 256 }));
        expect(container.innerHTML).toContain('256');
        overlay.dispose();
    });

    it('should display system timings sorted by cost', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({
            systemTimings: new Map([
                ['Fast', 0.1],
                ['Slow', 5.0],
                ['Medium', 1.5],
            ]),
        }));

        const html = container.innerHTML;
        const slowIdx = html.indexOf('Slow');
        const medIdx = html.indexOf('Medium');
        const fastIdx = html.indexOf('Fast');
        expect(slowIdx).toBeLessThan(medIdx);
        expect(medIdx).toBeLessThan(fastIdx);
        overlay.dispose();
    });

    it('should limit to top 5 systems', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        const timings = new Map<string, number>();
        for (let i = 0; i < 8; i++) {
            timings.set(`System${i}`, i);
        }
        overlay.update(makeStats({ systemTimings: timings }));
        const html = container.innerHTML;
        expect(html).toContain('System7');
        expect(html).toContain('System3');
        expect(html).not.toContain('System2');
        overlay.dispose();
    });

    it('should not render system section when empty', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats());
        expect(container.innerHTML).not.toContain('Systems');
        overlay.dispose();
    });

    it('should hide and show', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        const el = container.firstElementChild as HTMLElement;

        overlay.hide();
        expect(el.style.display).toBe('none');

        overlay.update(makeStats({ fps: 60 }));
        expect(el.innerHTML).toBe('');

        overlay.show();
        overlay.update(makeStats({ fps: 60 }));
        expect(el.innerHTML).toContain('60');
        overlay.dispose();
    });

    it('should remove element on dispose', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        expect(container.children.length).toBe(1);
        overlay.dispose();
        expect(container.children.length).toBe(0);
    });

    it('should truncate long system names', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({
            systemTimings: new Map([
                ['VeryLongSystemNameThatExceedsTwenty', 1.0],
            ]),
        }));
        expect(container.innerHTML).toContain('...');
        overlay.dispose();
    });

    // === Review fix: Medium #5 — XSS via system names ===

    it('should escape HTML in system names', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({
            systemTimings: new Map([
                ['<img src=x onerror=alert(1)>', 1.0],
            ]),
        }));
        const html = container.innerHTML;
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;');
        overlay.dispose();
    });

    // === Review fix: Medium #6 — padEnd spaces collapse in HTML ===

    it('should preserve whitespace alignment in system names', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({
            systemTimings: new Map([['Abc', 1.0]]),
        }));
        const el = container.firstElementChild as HTMLElement;
        expect(el.style.cssText).toContain('white-space');
        overlay.dispose();
    });

    // === Review fix: Low #11 — no-op after dispose ===

    it('should not throw when update is called after dispose', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.dispose();
        expect(() => overlay.update(makeStats({ fps: 60 }))).not.toThrow();
    });

    // === Throttle & avg/max ===

    it('should render immediately on first update', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        overlay.update(makeStats({ fps: 60 }));
        expect(container.innerHTML).toContain('60');
        overlay.dispose();
    });

    it('should throttle DOM updates within the interval', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({ fps: 30, entityCount: 111 }));
        expect(container.innerHTML).toContain('30');
        expect(container.innerHTML).toContain('111');

        now = 1100;
        overlay.update(makeStats({ fps: 55, entityCount: 222 }));
        expect(container.innerHTML).toContain('111');
        expect(container.innerHTML).not.toContain('222');

        overlay.dispose();
    });

    it('should render again after throttle interval elapses', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({ fps: 30 }));
        expect(container.innerHTML).toContain('30');

        now = 1600;
        overlay.update(makeStats({ fps: 55 }));
        expect(container.innerHTML).toContain('55');

        overlay.dispose();
    });

    it('should display avg and max for system timings', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 2.0]]),
        }));

        const html = container.innerHTML;
        expect(html).toContain('Physics');
        expect(html).toContain('2.0');
        overlay.dispose();
    });

    it('should accumulate system timings across throttled frames and show avg/max', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 1.0]]),
        }));

        now = 1100;
        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 5.0]]),
        }));
        now = 1200;
        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 1.0]]),
        }));

        now = 1600;
        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 3.0]]),
        }));

        const html = container.innerHTML;
        expect(html).toContain('Physics');
        expect(html).toContain('3.0');
        expect(html).toContain('5.0');
        overlay.dispose();
    });

    it('should sort systems by max value', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({
            systemTimings: new Map([['A', 0.5], ['B', 1.0]]),
        }));

        now = 1100;
        overlay.update(makeStats({
            systemTimings: new Map([['A', 10.0], ['B', 1.0]]),
        }));

        now = 1600;
        overlay.update(makeStats({
            systemTimings: new Map([['A', 0.5], ['B', 1.0]]),
        }));

        const html = container.innerHTML;
        const aIdx = html.indexOf('A');
        const bIdx = html.indexOf('B');
        expect(aIdx).toBeLessThan(bIdx);
        overlay.dispose();
    });

    it('should reset accumulator after rendering', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 10.0]]),
        }));

        now = 1600;
        overlay.update(makeStats({
            systemTimings: new Map([['Physics', 1.0]]),
        }));

        const html = container.innerHTML;
        expect(html).not.toContain('10.0');
        expect(html).toContain('1.0');
        overlay.dispose();
    });

    it('should render immediately after show() resets throttle', () => {
        const container = document.createElement('div');
        const overlay = new StatsOverlay(container);
        let now = 1000;
        vi.spyOn(performance, 'now').mockImplementation(() => now);

        overlay.update(makeStats({ fps: 30 }));
        expect(container.innerHTML).toContain('30');

        overlay.hide();
        now = 1050;
        overlay.show();
        overlay.update(makeStats({ fps: 45 }));
        expect(container.innerHTML).toContain('45');

        overlay.dispose();
    });
});

// ============================================================================
// FrameHistory
// ============================================================================

describe('FrameHistory', () => {
    it('should start empty', () => {
        const history = new FrameHistory();
        expect(history.count).toBe(0);
        expect(history.getAll()).toEqual([]);
    });

    it('should store pushed snapshots', () => {
        const history = new FrameHistory();
        history.push(16.7, new Map([['Update', 5.0]]));
        expect(history.count).toBe(1);
        const all = history.getAll();
        expect(all[0].frameTimeMs).toBeCloseTo(16.7);
        expect(all[0].phaseTimings.get('Update')).toBe(5.0);
        expect(all[0].systemTimings).toBeInstanceOf(Map);
        expect(all[0].systemTimings.size).toBe(0);
    });

    it('should store systemTimings when provided', () => {
        const history = new FrameHistory();
        const sysTimes = new Map([['PhysicsSystem', 1.5], ['RenderSystem', 3.2]]);
        history.push(16.7, new Map(), sysTimes);
        const snap = history.getLatest()!;
        expect(snap.systemTimings.get('PhysicsSystem')).toBe(1.5);
        expect(snap.systemTimings.get('RenderSystem')).toBe(3.2);
    });

    it('should deep copy systemTimings on push', () => {
        const history = new FrameHistory();
        const sysTimes = new Map([['Sys', 2.0]]);
        history.push(16.0, new Map(), sysTimes);
        sysTimes.set('Sys', 99.0);
        expect(history.getLatest()!.systemTimings.get('Sys')).toBe(2.0);
    });

    it('should preserve insertion order', () => {
        const history = new FrameHistory();
        history.push(10.0, new Map());
        history.push(20.0, new Map());
        history.push(30.0, new Map());
        const all = history.getAll();
        expect(all.map(s => s.frameTimeMs)).toEqual([10.0, 20.0, 30.0]);
    });

    it('should evict oldest when exceeding capacity', () => {
        const capacity = 300;
        const history = new FrameHistory(capacity);
        for (let i = 0; i < capacity + 10; i++) {
            history.push(i, new Map());
        }
        expect(history.count).toBe(capacity);
        const all = history.getAll();
        expect(all[0].frameTimeMs).toBe(10);
        expect(all[all.length - 1].frameTimeMs).toBe(capacity + 9);
    });

    it('should return latest snapshot', () => {
        const history = new FrameHistory();
        history.push(10.0, new Map());
        history.push(20.0, new Map());
        expect(history.getLatest()!.frameTimeMs).toBe(20.0);
    });

    it('should return null for latest when empty', () => {
        const history = new FrameHistory();
        expect(history.getLatest()).toBeNull();
    });

    it('should use default capacity of 300', () => {
        const history = new FrameHistory();
        for (let i = 0; i < 400; i++) {
            history.push(i, new Map());
        }
        expect(history.count).toBe(300);
    });

    it('should deep copy phase timings on push', () => {
        const history = new FrameHistory();
        const timings = new Map([['Update', 5.0]]);
        history.push(16.0, timings);
        timings.set('Update', 99.0);
        expect(history.getLatest()!.phaseTimings.get('Update')).toBe(5.0);
    });

    it('should reset to empty', () => {
        const history = new FrameHistory();
        for (let i = 0; i < 10; i++) history.push(i, new Map());
        expect(history.count).toBe(10);
        history.reset();
        expect(history.count).toBe(0);
        expect(history.getAll()).toEqual([]);
    });
});

// ============================================================================
// Phase Timings
// ============================================================================

describe('App phase timings', () => {
    it('should return null before enableStats', () => {
        const app = App.new();
        expect(app.getPhaseTimings()).toBeNull();
    });

    it('should return a Map after enableStats + tick', () => {
        const app = App.new();
        app.enableStats();
        app.tick(1 / 60);
        const pt = app.getPhaseTimings();
        expect(pt).toBeInstanceOf(Map);
    });

    it('should contain schedule phase names after tick', () => {
        const app = App.new();
        app.enableStats();
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => {}, { name: 'Dummy' }
        ));
        app.tick(1 / 60);
        const pt = app.getPhaseTimings()!;
        expect(pt.has('First')).toBe(true);
        expect(pt.has('PreUpdate')).toBe(true);
        expect(pt.has('Update')).toBe(true);
        expect(pt.has('PostUpdate')).toBe(true);
        expect(pt.has('Last')).toBe(true);
    });

    it('should have numeric values for each phase', () => {
        const app = App.new();
        app.enableStats();
        app.tick(1 / 60);
        const pt = app.getPhaseTimings()!;
        for (const [, v] of pt) {
            expect(typeof v).toBe('number');
            expect(v).toBeGreaterThanOrEqual(0);
        }
    });

    it('should work when enableStats called after first tick', () => {
        const app = App.new();
        app.tick(1 / 60);
        expect(app.getPhaseTimings()).toBeNull();

        app.enableStats();
        app.tick(1 / 60);
        expect(app.getPhaseTimings()).toBeInstanceOf(Map);
    });
});

// ============================================================================
// FrameStats phaseTimings field
// ============================================================================

describe('FrameStats phaseTimings', () => {
    it('should default to empty Map', () => {
        const stats = defaultFrameStats();
        expect(stats.phaseTimings).toBeInstanceOf(Map);
        expect(stats.phaseTimings.size).toBe(0);
    });

    it('should be populated by StatsPlugin', () => {
        const app = App.new();
        app.addPlugin(new StatsPlugin({ overlay: false }));
        app.addSystemToSchedule(Schedule.Update, defineSystem(
            [], () => {}, { name: 'TestSys' }
        ));
        app.tick(1 / 60);
        const stats = app.getResource(Stats);
        expect(stats.phaseTimings).toBeInstanceOf(Map);
        expect(stats.phaseTimings.size).toBeGreaterThan(0);
    });
});
