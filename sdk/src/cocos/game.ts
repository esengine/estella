// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/game.ts
 * @brief   `game` / `Game`: the running application — its frame clock and its show / hide / low-memory events.
 *
 * The clock is fed by the frame loop (`Cocos:Game`, below). The lifecycle events are the platform's, and are bound the first time a
 * script listens for one: a mini-game host and a browser tab both report being shown and hidden, and a script that never asks
 * costs the platform nothing. `restart` and `end` ask the host, since the application is not this layer's to restart.
 */
import { Schedule, defineSystem, addSystemToSchedule } from '../ecs/system';
import { Res, Time } from '../ecs/resource';
import { isPlatformInitialized, platformNow, platformOnAppHide, platformOnAppShow, platformOnMemoryWarning } from '../platform';
import { Emitter } from './emitter';
import { Node } from './node';

const EVENTS = Object.freeze({
    EVENT_HIDE: 'game_on_hide',
    EVENT_SHOW: 'game_on_show',
    EVENT_LOW_MEMORY: 'game_on_low_memory',
    EVENT_GAME_INITED: 'game_inited',
    EVENT_ENGINE_INITED: 'engine_inited',
    EVENT_PRE_BASE_INIT: 'pre_base_init',
    EVENT_POST_BASE_INIT: 'post_base_init',
    EVENT_PRE_SUBSYSTEM_INIT: 'pre_subsystem_init',
    EVENT_POST_SUBSYSTEM_INIT: 'post_subsystem_init',
    EVENT_PRE_PROJECT_INIT: 'pre_project_init',
    EVENT_POST_PROJECT_INIT: 'post_project_init',
    EVENT_RENDERER_INITED: 'renderer_inited',
    EVENT_RESTART: 'game_on_restart',
});

const RendererType = Object.freeze({ UNKNOWN: 0, CANVAS: 1, WEBGL: 2, OPENGL: 3, HEADLESS: 4, WEBGPU: 5 });

export class Game extends Emitter {
    static readonly EVENT_HIDE = EVENTS.EVENT_HIDE;
    static readonly EVENT_SHOW = EVENTS.EVENT_SHOW;
    static readonly EVENT_LOW_MEMORY = EVENTS.EVENT_LOW_MEMORY;
    static readonly EVENT_GAME_INITED = EVENTS.EVENT_GAME_INITED;
    static readonly EVENT_ENGINE_INITED = EVENTS.EVENT_ENGINE_INITED;
    static readonly EVENT_PRE_BASE_INIT = EVENTS.EVENT_PRE_BASE_INIT;
    static readonly EVENT_POST_BASE_INIT = EVENTS.EVENT_POST_BASE_INIT;
    static readonly EVENT_PRE_SUBSYSTEM_INIT = EVENTS.EVENT_PRE_SUBSYSTEM_INIT;
    static readonly EVENT_POST_SUBSYSTEM_INIT = EVENTS.EVENT_POST_SUBSYSTEM_INIT;
    static readonly EVENT_PRE_PROJECT_INIT = EVENTS.EVENT_PRE_PROJECT_INIT;
    static readonly EVENT_POST_PROJECT_INIT = EVENTS.EVENT_POST_PROJECT_INIT;
    static readonly EVENT_RENDERER_INITED = EVENTS.EVENT_RENDERER_INITED;
    static readonly EVENT_RESTART = EVENTS.EVENT_RESTART;
    static readonly RendererType = RendererType;

    readonly RendererType = RendererType;

    frameRate = 60;
    /** Seconds since the previous frame. */
    deltaTime = 0;
    /** Seconds the application has run. */
    totalTime = 0;
    /** The time the current frame began, in milliseconds. */
    frameStartTime = 0;
    renderType = RendererType.WEBGL;
    config: Record<string, unknown> = {};

    private paused_ = false;
    private inited_ = true;
    private bound_ = false;
    private readonly persist_ = new Set<Node>();

    get isInited(): boolean { return this.inited_; }
    get isPaused(): boolean { return this.paused_; }

    /** The page's canvas, when there is a page. */
    get canvas(): HTMLCanvasElement | null {
        if (typeof document === 'undefined') return null;
        return (document.getElementById('GameCanvas') ?? document.querySelector('canvas')) as HTMLCanvasElement | null;
    }
    get container(): HTMLElement | null { return this.canvas?.parentElement ?? null; }

    pause(): void { this.paused_ = true; }
    resume(): void { this.paused_ = false; }
    step(): void { /* a frame is the engine's to run */ }

    restart(): Promise<void> {
        this.emit(EVENTS.EVENT_RESTART);
        if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload();
        return Promise.resolve();
    }
    end(): void {
        if (typeof window !== 'undefined' && typeof window.close === 'function') window.close();
    }

    addPersistRootNode(node: Node): void { this.persist_.add(node); }
    removePersistRootNode(node: Node): void { this.persist_.delete(node); }
    isPersistRootNode(node: Node): boolean { return this.persist_.has(node); }

    /** The platform's show / hide / low-memory notices are bound when a script first asks to hear one. */
    override on(type: string, callback: (...args: any[]) => void, target?: unknown): typeof callback {
        this.bind_();
        return super.on(type, callback, target);
    }

    private bind_(): void {
        if (this.bound_ || !isPlatformInitialized()) return;
        this.bound_ = true;
        try {
            platformOnAppShow(() => this.emit(EVENTS.EVENT_SHOW));
            platformOnAppHide(() => this.emit(EVENTS.EVENT_HIDE));
            platformOnMemoryWarning(() => this.emit(EVENTS.EVENT_LOW_MEMORY));
        } catch {
            // a platform without these notices: the events simply never fire
        }
    }

    /** @internal Called by the frame loop. */
    _tick(delta: number, elapsed: number): void {
        this.deltaTime = delta;
        this.totalTime = elapsed;
        this.frameStartTime = isPlatformInitialized() ? platformNow() : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
}

export const game = new Game();

/** Register the system that feeds the game clock. */
export function declareGameSystem(): void {
    const system = defineSystem(
        [Res(Time)],
        (time) => { game._tick(time.delta, time.elapsed); },
        { name: 'Cocos:Game', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.First, system);
}
