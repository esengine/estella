import { Renderer } from './renderer';
import { defineResource, Res, Time } from './resource';
import { defineSystem, GetWorld, Schedule } from './system';
import type { App, Plugin } from './app';
import { StatsOverlay, type StatsPosition } from './stats-overlay';

export interface FrameStats {
    fps: number;
    frameTimeMs: number;
    entityCount: number;
    systemTimings: Map<string, number>;
    drawCalls: number;
    triangles: number;
    sprites: number;
    text: number;
    spine: number;
    meshes: number;
    culled: number;
}

export function defaultFrameStats(): FrameStats {
    return {
        fps: 0,
        frameTimeMs: 0,
        entityCount: 0,
        systemTimings: new Map(),
        drawCalls: 0,
        triangles: 0,
        sprites: 0,
        text: 0,
        spine: 0,
        meshes: 0,
        culled: 0,
    };
}

export const Stats = defineResource<FrameStats>(defaultFrameStats(), 'Stats');

const SLIDING_WINDOW_SIZE = 60;
const STATS_COLLECT_SYSTEM_NAME = 'StatsCollect';

export class StatsCollector {
    private deltas_: number[] = [];
    private cursor_ = 0;
    private count_ = 0;
    private sum_ = 0;

    pushFrame(deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;

        if (this.count_ < SLIDING_WINDOW_SIZE) {
            this.deltas_.push(deltaSeconds);
            this.sum_ += deltaSeconds;
            this.count_++;
        } else {
            this.sum_ -= this.deltas_[this.cursor_];
            this.deltas_[this.cursor_] = deltaSeconds;
            this.sum_ += deltaSeconds;
            this.cursor_ = (this.cursor_ + 1) % SLIDING_WINDOW_SIZE;
        }
    }

    getFps(): number {
        if (this.count_ === 0 || this.sum_ <= 0) return 0;
        return this.count_ / this.sum_;
    }

    getFrameTimeMs(): number {
        if (this.count_ === 0 || this.sum_ <= 0) return 0;
        return (this.sum_ / this.count_) * 1000;
    }

    reset(): void {
        this.deltas_.length = 0;
        this.cursor_ = 0;
        this.count_ = 0;
        this.sum_ = 0;
    }
}

export interface StatsPluginOptions {
    overlay?: boolean;
    position?: StatsPosition;
    container?: HTMLElement;
}

export class StatsPlugin implements Plugin {
    readonly name = 'Stats';
    private collector_ = new StatsCollector();
    private overlay_: StatsOverlay | null = null;
    private options_: StatsPluginOptions;

    constructor(options?: StatsPluginOptions) {
        this.options_ = options ?? {};
    }

    build(app: App): void {
        this.collector_.reset();

        app.enableStats();
        app.insertResource(Stats, defaultFrameStats());

        const showOverlay = this.options_.overlay !== false;
        if (showOverlay && typeof document !== 'undefined') {
            const container = this.options_.container ?? document.body;
            this.overlay_ = new StatsOverlay(container, this.options_.position);
        }

        const collector = this.collector_;
        const overlay = this.overlay_;

        const statsCollectSystem = defineSystem(
            [Res(Time), GetWorld()],
            (time, world) => {
                collector.pushFrame(time.delta);

                const stats = app.getResource(Stats);
                stats.fps = collector.getFps();
                stats.frameTimeMs = collector.getFrameTimeMs();
                stats.entityCount = world.entityCount();

                const timings = app.getSystemTimings();
                if (timings) {
                    const copy = new Map(timings);
                    copy.delete(STATS_COLLECT_SYSTEM_NAME);
                    stats.systemTimings = copy;
                } else {
                    stats.systemTimings = new Map();
                }

                const renderStats = Renderer.getStats();
                stats.drawCalls = renderStats.drawCalls;
                stats.triangles = renderStats.triangles;
                stats.sprites = renderStats.sprites;
                stats.text = renderStats.text;
                stats.spine = renderStats.spine;
                stats.meshes = renderStats.meshes;
                stats.culled = renderStats.culled;

                overlay?.update(stats);
            },
            { name: STATS_COLLECT_SYSTEM_NAME }
        );

        app.addSystemToSchedule(Schedule.Last, statsCollectSystem);
    }

    cleanup(): void {
        this.overlay_?.dispose();
        this.overlay_ = null;
    }
}

export const statsPlugin = new StatsPlugin();
