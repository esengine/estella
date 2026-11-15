// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/app/app';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Time } from '../src/ecs/resource';
import { Input, InputState, inputEventCallbacks } from '../src/input/input';
import { inputRouter } from '../src/input/inputRouter';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

const apps: App[] = [], frames=new Map<number,FrameRequestCallback>();let nextFrame=0;
beforeEach(()=>{
    setPlatform(webAdapter);
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{const id=++nextFrame;frames.set(id,callback);return id;});
    vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
    inputRouter.setUIHandler(null);inputRouter.setEditorHandler(null);
});
afterEach(()=>{for(const app of apps.splice(0))app.quit();frames.clear();vi.unstubAllGlobals();inputRouter.setUIHandler(null);});
function build(){const app=App.new();apps.push(app);return app;}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
it('holds every schedule, frame observers and forced stepping without changing user pause',async()=>{
    const app=build(), events:string[]=[];
    for(const schedule of [Schedule.Startup,Schedule.First,Schedule.Update,Schedule.Last])app.addSystemToSchedule(schedule,defineSystem([],()=>{events.push(Schedule[schedule]);}));
    app.onFrameEnd(()=>events.push('frame'));app.setPaused(true);
    const first=app.holdExecution(),second=app.holdExecution();
    app.stepFrame();
    await app.tick(1/60);await app.stepFrames(3);expect(events).toEqual([]);
    first();first();await app.tick(1/60);expect(events).toEqual([]);expect(app.isPaused()).toBe(true);
    second();await app.tick(1/60);expect(events).toEqual(['Startup','Last','frame']);expect(app.isPaused()).toBe(true);
    app.setPaused(false);await app.tick(1/60);expect(events.slice(-4)).toEqual(['First','Update','Last','frame']);
});
it('discards queued keyboard/pointer input and blocks the native gesture router while held',async()=>{
    const app=build(),input=new InputState();app.insertResource(Input,input);
    const routed=vi.fn(()=>false);inputRouter.setUIHandler({onPointerUp:routed,onTouchEnd:routed,onKeyDown:routed});
    const callbacks=inputEventCallbacks(input);callbacks.onKeyDown?.('KeyD');callbacks.onPointerDown?.(0,10,10);
    const release=app.holdExecution();expect(input.keysDown.size).toBe(0);expect(input.mouseButtons.size).toBe(0);routed.mockClear();
    callbacks.onPointerUp?.(0);callbacks.onTouchEnd?.(1);expect(callbacks.onKeyDown?.('Space')).toBe(false);
    expect(routed).not.toHaveBeenCalled();expect(input.keysDown.size).toBe(0);
    release();callbacks.onKeyDown?.('KeyD');expect(input.keysDown.has('KeyD')).toBe(true);
});
it('stops dependent systems after a hold interrupts an asynchronous frame, even when released early',async()=>{
    const app=build(),waiting=deferred(),started=deferred(), events:string[]=[];
    app.addSystemToSchedule(Schedule.Update,defineSystem([],async()=>{events.push('first');started.resolve();await waiting.promise;},{name:'AsyncFirst'}));
    app.addSystemToSchedule(Schedule.Update,defineSystem([],()=>{events.push('second');},{name:'Dependent',runAfter:['AsyncFirst']}));
    app.addSystemToSchedule(Schedule.Last,defineSystem([],()=>{events.push('render');}));app.onFrameEnd(()=>events.push('observed'));
    const tick=app.tick(1/60);await started.promise;const release=app.holdExecution();release();waiting.resolve();await tick;
    expect(events).toEqual(['first']);await app.tick(1/60);expect(events.slice(-4)).toEqual(['first','second','render','observed']);
});
it('preserves unstarted startup systems and waits for the interrupted startup before an automatic frame',async()=>{
    const app=build(),waiting=deferred(),started=deferred(),events:string[]=[];
    app.addSystemToSchedule(Schedule.Startup,defineSystem([],async()=>{events.push('start-a');started.resolve();await waiting.promise;},{name:'StartA'}));
    app.addSystemToSchedule(Schedule.Startup,defineSystem([],()=>{events.push('start-b');},{name:'StartB',runAfter:['StartA']}));
    app.addSystemToSchedule(Schedule.Update,defineSystem([],()=>{events.push('update');}));
    const running=app.run();await started.promise;const release=app.holdExecution();release();
    await vi.waitFor(()=>expect(frames.size).toBe(1));const [id,callback]=frames.entries().next().value!;frames.delete(id);callback(performance.now());
    await Promise.resolve();expect(events).toEqual(['start-a']);waiting.resolve();await running;
    await vi.waitFor(()=>expect(events).toEqual(['start-a','start-b','update']));
});
it('can be held before run and resumes only one RAF loop with a fresh clock',async()=>{
    const app=build(),observe=vi.fn();app.onFrameEnd(observe);
    const release=app.holdExecution();await app.run();expect(observe).not.toHaveBeenCalled();expect(frames.size).toBe(0);
    release();release();await vi.waitFor(()=>expect(frames.size).toBe(1));
    const [id,callback]=frames.entries().next().value!;frames.delete(id);callback(performance.now());
    await vi.waitFor(()=>expect(observe).toHaveBeenCalledOnce());expect(app.getResource(Time).delta).toBeLessThan(0.1);
    expect(frames.size).toBe(1);
});
it('ignores stale releases after quit and withdraws execution observers',async()=>{
    const app=build(),observer=vi.fn();app.onExecutionChange(observer);const release=app.holdExecution();
    expect(observer.mock.calls.map(args=>args[0])).toEqual([false,true]);app.quit();release();expect(frames.size).toBe(0);
    app.holdExecution();expect(observer).toHaveBeenCalledTimes(2);
});
it('keeps automatic running intent after a forced step is interrupted',async()=>{
    const app=build(),waiting=deferred(),started=deferred();let block=false;
    app.addSystemToSchedule(Schedule.Update,defineSystem([],async()=>{if(block){started.resolve();await waiting.promise;}}));
    await app.run();await vi.waitFor(()=>expect(frames.size).toBe(1));block=true;
    const stepping=app.stepFrames(3);await started.promise;const release=app.holdExecution();
    waiting.resolve();await stepping;expect(frames.size).toBe(0);
    release();await vi.waitFor(()=>expect(frames.size).toBe(1));
});
it('preserves input holds owned by another app sharing the state',()=>{
    const a=build(),b=build(),input=new InputState();a.insertResource(Input,input);b.insertResource(Input,input);
    const releaseA=a.holdExecution(),releaseB=b.holdExecution(),callbacks=inputEventCallbacks(input);
    a.quit();releaseA();callbacks.onKeyDown?.('KeyD');expect(input.keysDown.size).toBe(0);
    releaseB();callbacks.onKeyDown?.('KeyD');expect(input.keysDown.has('KeyD')).toBe(true);
});
it('does not leave a forced step queued after interruption of a user-paused app',async()=>{
    const app=build(),waiting=deferred(),started=deferred();let updates=0;
    app.setPaused(true);app.addSystemToSchedule(Schedule.Update,defineSystem([],async()=>{updates++;started.resolve();await waiting.promise;}));
    await app.run();await vi.waitFor(()=>expect(frames.size).toBe(1));
    const stepping=app.stepFrames(2);await started.promise;const release=app.holdExecution();waiting.resolve();await stepping;
    release();await vi.waitFor(()=>expect(frames.size).toBe(1));
    const [id,callback]=frames.entries().next().value!;frames.delete(id);callback(performance.now());
    await vi.waitFor(()=>expect(frames.size).toBe(1));expect(updates).toBe(1);expect(app.isPaused()).toBe(true);
});
it('a frame observer that unsubscribes itself does not skip the next one',async()=>{
    const app=build(),seen:string[]=[];
    const off=app.onFrameEnd(()=>{seen.push('first');off();});app.onFrameEnd(()=>seen.push('second'));
    await app.tick(1/60);expect(seen).toEqual(['first','second']);
});
