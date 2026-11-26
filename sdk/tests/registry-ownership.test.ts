// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {App,createWebApp} from '../src/app/app';
import {createHeadlessApp} from '../src/runtime/webAppFactory';
import {AppContext,setDefaultContext} from '../src/ecs/context';
import {createMockModule} from './mocks/wasm';
import {setPlatform} from '../src/platform/base';
import {nodeAdapter} from '../src/platform/node';
import {webAdapter} from '../src/platform/web';
import {Input, inputPlugin} from '../src/input/input';
import type { RenderSurfaceSource } from '../src/app/app';

// Ownership tests isolate graphics bootstrap; actual editor runs exercise it.
vi.mock('../src/app/corePlugin',async importOriginal=>({...await importOriginal<typeof import('../src/app/corePlugin')>(),corePlugin:{build(){}}}));
beforeEach(()=>{setDefaultContext(new AppContext());setPlatform(nodeAdapter);});

function fixture(){
    const module=createMockModule(),registry=module.getRegistry();
    const release=vi.fn(),shutdown=vi.fn();registry.delete=release;
    Object.assign(module,{Registry:function(){return registry;},initRenderer:vi.fn(()=>true),shutdownRenderer:shutdown});
    return{module,registry,release,shutdown};
}

describe('App registry ownership',()=>{
    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory deletes its own registry once even when preserving the renderer',(_name,factory)=>{
        const f=fixture(),app=factory(f.module);
        f.release.mockImplementation(()=>expect(app.world.hasCpp).toBe(false));
        app.world.spawn();app.quit({keepRenderer:true});app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();expect(app.world.entityCount()).toBe(0);
    });

    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory releases ownership when plugin construction throws',(_name,factory)=>{
        const f=fixture(),cleanup=vi.fn(),failure=new Error('plugin build failed');
        expect(()=>factory(f.module,{plugins:[{build(){},cleanup},{build(){throw failure;}}]})).toThrow(failure);
        expect(cleanup).toHaveBeenCalledTimes(1);expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();
    });

    it.each([['web',createWebApp],['headless',createHeadlessApp]] as const)('%s factory releases a registry rejected by strict binding verification',(_name,factory)=>{
        const f=fixture();Object.assign(f.registry,{addSprite:undefined});
        expect(()=>factory(f.module)).toThrow(/Sprite/);expect(f.release).toHaveBeenCalledTimes(1);
    });

    it('web initialization failure releases the registry and retains the original renderer error',()=>{
        const f=fixture(),failure=new Error('renderer failed');Object.assign(f.module,{initRenderer(){throw failure;}});
        expect(()=>createWebApp(f.module)).toThrow(failure);expect(f.release).toHaveBeenCalledTimes(1);
    });

    it.each(['default','gl-context','glx'] as const)('%s renderer refusal aborts before project plugins and releases only its registry',kind=>{
        const f=fixture(),build=vi.fn();
        Object.assign(f.module,{initRenderer:vi.fn(()=>false),initRendererWithContext:vi.fn(()=>false)});
        const renderSurface=kind==='default'?{kind:'default' as const}:{kind:'gl-context' as const,handle:73,glx:kind==='glx'};
        expect(()=>createWebApp(f.module,{renderSurface,plugins:[{build}]})).toThrow(/WebGL2 renderer initialization failed/);
        expect(build).not.toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.shutdown).not.toHaveBeenCalled();
        if(kind!=='default')expect(f.module.initRendererWithContext).toHaveBeenCalledWith(73);
    });

    it.each(['default','gl-context','glx'] as const)('%s successful renderer initializes plugins and preserves the shared renderer on quit',kind=>{
        const f=fixture(),build=vi.fn();
        Object.assign(f.module,{initRendererWithContext:vi.fn(()=>true)});
        const renderSurface=kind==='default'?{kind:'default' as const}:{kind:'gl-context' as const,handle:73,glx:kind==='glx'};
        const app=createWebApp(f.module,{renderSurface,plugins:[{build}]});
        expect(build).toHaveBeenCalledTimes(1);app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(f.shutdown).not.toHaveBeenCalled();
    });

    it.each(['gl-context', 'webgpu', 'default', 'threaded-webgl2', 'threaded-webgpu'] as const)(
        'installs input on the canvas selected by the %s renderer', kind => {
            setPlatform(webAdapter);
            const preview = document.createElement('canvas'), game = document.createElement('canvas');
            game.id = kind === 'webgpu' ? 'custom-game' : 'canvas';
            document.body.append(preview, game);
            const { module } = fixture();
            const gl = { GLctx: { canvas: game } };
            Object.assign(module, {
                canvas: preview,
                GL: { contexts: [null, gl], currentContext: kind === 'default' ? gl : { GLctx: { canvas: preview } } },
                initRendererWithContext: () => true, initRendererWebGPU: () => true,
                renderThread_bootStatus: () => kind === 'threaded-webgpu' ? 2 : 1,
            });
            const renderSurface: RenderSurfaceSource = kind === 'gl-context' ? { kind, handle: 1 }
                : kind === 'webgpu' ? { kind, canvasSelector: '#custom-game' } : { kind };
            const app = createWebApp(module, { renderSurface });
            try {
                const input = app.getResource(Input);
                app.addPlugin(inputPlugin);
                expect(app.getResource(Input)).toBe(input);
                preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                expect(input.isMouseButtonDown(0)).toBe(false);
                game.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                expect(input.isMouseButtonDown(0)).toBe(true);
            } finally {
                app.quit({ keepRenderer: true });
                preview.remove(); game.remove();
            }
        });

    it('keeps host controls touchable before the render canvas is mounted', () => {
        setPlatform(webAdapter);
        const game = document.createElement('canvas');
        const button = document.body.appendChild(document.createElement('button'));
        const { module } = fixture();
        Object.assign(module, { canvas: game, initRendererWithContext: () => true });
        const app = createWebApp(module, { renderSurface: { kind: 'gl-context', handle: 1 } });
        const touch = () => Object.assign(new Event('touchstart', { bubbles: true, cancelable: true }), {
            changedTouches: [{ identifier: 2, clientX: 6, clientY: 8 }],
        });
        try {
            const input = app.getResource(Input);
            expect(button.dispatchEvent(touch())).toBe(true);
            expect(input.touches.size).toBe(0);
            document.body.append(game);
            expect(game.dispatchEvent(touch())).toBe(false);
            expect(input.touches.has(2)).toBe(true);
        } finally {
            app.quit({ keepRenderer: true });
            button.remove(); game.remove();
        }
    });

    it('a failed verification retains its diagnostic even when registry deletion throws',()=>{
        const f=fixture(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});Object.assign(f.registry,{addSprite:undefined});f.release.mockImplementation(()=>{throw Error('destructor failure');});
        try{expect(()=>createHeadlessApp(f.module)).toThrow(/Sprite/);expect(f.release).toHaveBeenCalledTimes(1);}
        finally{warn.mockRestore();}
    });

    it('an external borrowed registry survives quit and can connect to another App',()=>{
        const f=fixture(),app=App.new();app.connectCpp(f.registry,f.module);app.world.spawn();app.quit({keepRenderer:true});
        expect(f.release).not.toHaveBeenCalled();const next=App.new();next.connectCpp(f.registry,f.module);
        expect(next.world.valid(next.world.spawn())).toBe(true);next.quit({keepRenderer:true});expect(f.release).not.toHaveBeenCalled();
    });

    it('owned registry disposal is reentrant, attempted once, and cannot reconnect during quit',()=>{
        const f=fixture(),app=App.new(),warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
        app.connectCpp(f.registry,f.module,{ownedRegistry:true});
        f.release.mockImplementation(()=>{expect(app.world.hasCpp).toBe(false);app.quit({keepRenderer:true});expect(()=>app.connectCpp(f.registry,f.module)).toThrow(/while App.quit/);throw Error('destructor failure');});
        try{app.quit({keepRenderer:true});app.quit({keepRenderer:true});expect(f.release).toHaveBeenCalledTimes(1);expect(app.world.hasCpp).toBe(false);}
        finally{warn.mockRestore();}
    });

    it('replacing a live owned registry is rejected before touching either instance',()=>{
        const f=fixture(),other=fixture(),app=App.new();app.connectCpp(f.registry,f.module,{ownedRegistry:true});
        expect(()=>app.connectCpp(other.registry,other.module)).toThrow(/before replacing/);
        expect(app.world.getCppRegistry()).toBe(f.registry);expect(f.release).not.toHaveBeenCalled();expect(other.release).not.toHaveBeenCalled();
        app.quit({keepRenderer:true});app.connectCpp(other.registry,other.module,{ownedRegistry:true});app.quit({keepRenderer:true});
        expect(f.release).toHaveBeenCalledTimes(1);expect(other.release).toHaveBeenCalledTimes(1);
    });
});
