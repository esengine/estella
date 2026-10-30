// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { Canvas, Name, Transform, Parent, Children, registerComponent } from '../src/ecs/component';
import { Schedule, defineSystem } from '../src/ecs/system';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { Input, InputState } from '../src/input/input';
import { UIEvents, UIEventQueue } from '../src/ui/core/events';
import { UITreeView } from '../src/ui/behavior/tree-view';
import { UIColorPicker } from '../src/ui/behavior/color-picker';
import { installColorPickers } from '../src/ui/behavior/color-picker-system';
import { UISlider, createSliderSystem } from '../src/ui/behavior/slider';
import { createTreeView, installTreeViews } from '../src/ui/widgets/tree-view';
import { createColorPicker } from '../src/ui/widgets/color-picker';
import { TextInput } from '../src/ui/text/text-input';
import { Text } from '../src/ui/core/text';
import { UINode } from '../src/ui/core/ui-node';
import { UIVisual } from '../src/ui/core/ui-visual';
import { spawnUIEntity } from '../src/ui/core/compose';
import { px } from '../src/ui/core/dimension';
import { UIControlPointers } from '../src/ui/input/control-pointers';
import { FocusManager, FocusManagerState, Focusable } from '../src/ui/input/focusable';
import { Interactable } from '../src/ui/input/interactable';
import { UIInteractionPlugin } from '../src/ui/input/interaction';
import { ScreenOverlay, defaultScreenOverlay } from '../src/ui/core/screen-overlay';
import { ScreenLayout, screenLayoutRect, screenProjection } from '../src/ui/core/screen-layout';
import { UICameraInfo } from '../src/ui/core/ui-camera-info';
import { ListViewRegistry } from '../src/ui/collection/list-view';
import { ScrollContainerRegistry } from '../src/ui/collection/scroll-container';
import { UIController } from '../src/ui/controller/ui-controller';
import { UIGear } from '../src/ui/controller/ui-gear';
import { ThemeStyle } from '../src/ui/theme/theme-style';
import { widgetToPrefab } from '../src/ui/widgets/toPrefab';
import { instantiatePrefab } from '../src/prefab';
import { col } from '../src/math/color';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import { initResourceManager, shutdownResourceManager, textureRefill } from '../src/wasm/resourceManager';
import { Prefabs } from '../src/prefab/prefabServer';

describe.skipIf(!HAS_WASM)('TreeView / ColorPicker on real WASM', () => {
    let engine: ESEngineModule, registry: CppRegistry, app: App, events: UIEventQueue;
    let offTree: () => void, offColor: () => void, lists: ListViewRegistry, root: number;
    let interaction: UIInteractionPlugin | undefined;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => {
        setDefaultContext(new AppContext()); setEditorMode(false); setPlayMode(false);
        registry = new engine.Registry(); app = App.new(); app.connectCpp(registry, engine);
        events = new UIEventQueue(); app.insertResource(UIEvents, events);
        for (const component of [UITreeView, UIColorPicker, UISlider, TextInput, Text, Name, Focusable, UIController, UIGear, ThemeStyle]) registerComponent(component._name, component);
        app.insertResource(Input, new InputState()); app.insertResource(FocusManager, new FocusManagerState());
        const layout = screenLayoutRect(null, 800, 600); app.insertResource(ScreenLayout, layout);
        app.insertResource(ScreenOverlay, { ...defaultScreenOverlay(), active: true, projection: screenProjection(layout), vpW:800,vpH:600,surfaceW:800,surfaceH:600 });
        app.insertResource(UICameraInfo, structuredClone(UICameraInfo._default)); app.insertResource(UIControlPointers, { pointers:new Map(), cancelHold: () => {} });
        lists=new ListViewRegistry();const scrolls=new ScrollContainerRegistry();
        offTree=installTreeViews(app,{registerListView:list=>lists.add(list),unregisterListView:list=>lists.remove(list),attachScrollContainer:(e,c)=>scrolls.attach(e,c),detachScrollContainer:e=>scrolls.detach(e)});
        offColor=installColorPickers(app);
        app.addSystemToSchedule(Schedule.Update,createSliderSystem(app.world,events));
        app.addSystemToSchedule(Schedule.Update,defineSystem([],()=>lists.tick(),{name:'ListViewSystem'}));
        root=spawnUIEntity({world:app.world,node:{width:px(800),height:px(600)}});app.world.insert(root,Canvas);
    });
    afterEach(()=>{interaction?.cleanup(app);interaction=undefined;offTree();offColor();shutdownResourceManager();app.quit({keepRenderer:true});registry.delete();});
    async function tick() { engine.uiLayout_update(registry,-400,-300,400,300,true);engine.transform_update(registry);await app.tick(.016);app.getResource(Input).keysPressed.clear(); }
    const tree=()=>createTreeView({world:app.world,events,parent:root,node:{width:px(300),height:px(128)},nodes:[{id:'root',label:'Root',children:[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}]}],settings:{expandedIds:['root']}});
    const picker=()=>createColorPicker({world:app.world,events,parent:root});
    it('row style prefabs fit the shared wrapper and keep disclosure controls above them',async()=>{
        const styled:number[]=[];
        app.insertResource(Prefabs,{instantiate:async(_ref:string,options:{parent:number})=>{
            const panel=spawnUIEntity({world:app.world,parent:options.parent,node:{width:px(99),height:px(20)},visual:{color:col.rgb(.2,.2,.2)}});
            const label=spawnUIEntity({world:app.world,parent:panel,node:{fill:true},text:{content:'Custom'}});styled.push(panel);
            return {root:panel,entities:new Map([[0,panel],[1,label]])};
        }} as never);
        const handle=tree();app.world.update(handle.entity,UITreeView,data=>{data.rowPrefab='Row.esprefab';});
        await tick();await tick();await tick();
        expect(styled).toHaveLength(3);
        expect(engine.getUINodeComputedWidth!(registry,styled[0])).toBeCloseTo(300);
        const row=app.world.get(styled[0],Parent).entity,children=app.world.get(row,Children).entities;
        const arrow=children.find(e=>app.world.tryGet(e,Name)?.value==='TreeDisclosure:root')!;
        expect(children.indexOf(arrow)).toBeGreaterThan(children.indexOf(styled[0]));
        expect(app.world.getEntitiesWithComponents([Text]).some(e=>app.world.get(e,Text).content==='Root')).toBe(true);
    });
    it('a late row style cannot resurrect a disposed tree',async()=>{
        let finish:(value:unknown)=>void=()=>{};const loading=new Promise(resolve=>{finish=resolve;});
        app.insertResource(Prefabs,{instantiate:()=>loading} as never);
        const handle=tree();app.world.update(handle.entity,UITreeView,data=>{data.rowPrefab='Row.esprefab';});await tick();handle.dispose();
        const late=spawnUIEntity({world:app.world,node:{width:px(100),height:px(32)}});
        finish({root:late,entities:new Map([[0,late]])});await Promise.resolve();await Promise.resolve();expect(app.world.valid(late)).toBe(false);
    });
    it('shares ramps, updates the plane only for hue, restores its content, and releases each texture once',async()=>{
        let next=1;const create=vi.fn((_width:number,_height:number,_pixels:Uint8Array)=>next++),release=vi.fn(),update=vi.fn();
        initResourceManager({createTextureFromBytes:create,releaseTexture:release,updateTextureSubregionFromBytes:update} as never);
        const first=picker();picker();await tick();await tick();expect(create).toHaveBeenCalledTimes(5);
        const pixels=create.mock.calls[3][2],hue=col.toHsv(first.getColor()).h;
        for(const x of [0,16,32,63])for(const y of [0,16,32,63]){
            const expected=col.fromHsv(hue,x/63,y/63);const at=(y*64+x)*4;
            expect([...pixels.slice(at,at+3)]).toEqual([expected.r,expected.g,expected.b].map(v=>Math.round(v*255)));
        }
        first.setColor(col.fromHsv(30,.6,.8));await tick();await tick();expect(create).toHaveBeenCalledTimes(5);expect(update).toHaveBeenCalledTimes(1);
        first.setColor(col.fromHsv(30,.4,.5,.6));await tick();await tick();expect(update).toHaveBeenCalledTimes(1);
        const restore=textureRefill(4)!;expect(restore()).toBe(true);expect(update).toHaveBeenCalledTimes(2);
        const insert=vi.spyOn(app.world,'insert');try{await tick();expect(insert.mock.calls.filter(([,component])=>component===UIVisual||component===UINode)).toHaveLength(0);}finally{insert.mockRestore();}
        offColor();expect(release).toHaveBeenCalledTimes(5);expect(textureRefill(4)).toBeUndefined();expect(restore()).toBe(false);
        offColor();expect(release).toHaveBeenCalledTimes(5);
    });
    it('real hit testing drives sustained SV pointer capture without a second input path',async()=>{
        interaction=new UIInteractionPlugin();interaction.build(app);
        const handle=picker();await tick();await tick();const data=app.world.get(handle.entity,UIColorPicker);
        const at=app.world.get(data.sv,Transform).worldPosition,input=app.getResource(Input);
        input.mouseX=at.x+400;input.mouseY=300-at.y;input.noteMouseDown(0);await tick();input.clearFrameState();
        expect(app.getResource(UIControlPointers).pointers.get(-1)?.entity).toBe(data.sv);
        expect(col.toHsv(handle.getColor()).s).toBeCloseTo(.5);expect(col.toHsv(handle.getColor()).v).toBeCloseTo(.5);
        input.mouseX+=60;await tick();expect(col.toHsv(handle.getColor()).s).toBeGreaterThan(.7);
    });
    it('real row clicks select through the shared event queue',async()=>{
        interaction=new UIInteractionPlugin();interaction.build(app);
        const handle=tree();await tick();await tick();
        const row=app.world.getEntitiesWithComponents([Name]).find(e=>app.world.get(e,Name).value==='TreeRow:a')!;
        const at=app.world.get(row,Transform).worldPosition,input=app.getResource(Input);
        input.mouseX=at.x+400;input.mouseY=300-at.y;input.noteMouseDown(0);await tick();input.clearFrameState();
        input.mouseButtons.delete(0);input.mouseButtonsReleased.add(0);await tick();
        expect(handle.getModel()!.selectedIds).toEqual(['a']);expect(app.getResource(FocusManager).focusedEntity).toBe(handle.entity);
        input.clearFrameState();
        const disclosure=app.world.getEntitiesWithComponents([Name]).find(e=>app.world.get(e,Name).value==='TreeDisclosure:root')!;
        const arrowAt=app.world.get(disclosure,Transform).worldPosition;
        input.mouseX=arrowAt.x+400;input.mouseY=300-arrowAt.y;input.noteMouseDown(0);await tick();input.clearFrameState();
        input.mouseButtons.delete(0);input.mouseButtonsReleased.add(0);await tick();
        expect(handle.getModel()!.getCount()).toBe(1);expect(handle.getModel()!.selectedIds).toEqual(['a']);
    });
    it('stable controls avoid rewriting unchanged visual geometry',async()=>{
        tree();picker();for(let i=0;i<4;i++)await tick();const insert=vi.spyOn(app.world,'insert');
        try {await tick();expect(insert.mock.calls.filter(([,component])=>component===UINode||component===Text||component===UIVisual)).toHaveLength(0);}finally{insert.mockRestore();}
    });
    it('foreign picker references cannot overwrite another widget',async()=>{
        const a=picker(),b=picker();await tick();const target=app.world.get(b.entity,UIColorPicker).preview;
        app.world.update(a.entity,UIColorPicker,data=>{data.preview=target;});a.setColor(col.rgb(1,0,0));await tick();
        expect(col.equals(app.world.get(target,UIVisual).color,b.getColor())).toBe(true);
    });
    it('virtualizes 10,000 rows with a bounded entity count and follows viewport resize',async()=>{
        const handle=createTreeView({world:app.world,events,parent:root,node:{width:px(300),height:px(128)},nodes:Array.from({length:10000},(_,i)=>({id:String(i),label:`Row ${i}`}))});
        await tick();await tick();expect(handle.getModel()!.getCount()).toBe(10000);expect(lists.count()).toBe(1);
        expect(app.world.getEntitiesWithComponents([Text]).length).toBeLessThan(20);
        const viewport=app.world.get(handle.entity,Children).entities.find(e=>app.world.has(e,UINode)&&app.world.get(e,UINode).pointerEvents===0)!;
        expect(engine.getUINodeComputedWidth!(registry,viewport)).toBeCloseTo(300);
        expect(engine.getUINodeComputedHeight!(registry,viewport)).toBeCloseTo(128);
        app.world.update(handle.entity,UINode,node=>{node.width=px(200);node.height=px(64);});await tick();await tick();
        expect(engine.getUINodeComputedWidth!(registry,viewport)).toBeCloseTo(200);
        expect(engine.getUINodeComputedHeight!(registry,viewport)).toBeCloseTo(64);
        handle.reveal('9999');await tick();expect(app.world.getEntitiesWithComponents([Text]).some(e=>app.world.get(e,Text).content==='Row 9999')).toBe(true);
        handle.dispose();expect(lists.count()).toBe(0);
    });
    it('authored and factory trees share keyboard selection and collapse state',async()=>{
        const handle=tree();await tick();app.getResource(FocusManager).focus(handle.entity,true);
        app.getResource(Input).keysPressed.add('ArrowDown');await tick();expect(handle.getModel()!.selectedIds).toEqual(['root']);
        app.getResource(Input).keysPressed.add('ArrowDown');await tick();expect(handle.getModel()!.selectedIds).toEqual(['a']);
        app.getResource(Input).keysPressed.add('ArrowLeft');await tick();expect(handle.getModel()!.selectedIds).toEqual(['root']);
        app.getResource(Input).keysPressed.add('ArrowLeft');await tick();expect(handle.getModel()!.getCount()).toBe(1);
    });
    it('component removal disposes its registered list and subscriptions',async()=>{
        const handle=tree();await tick();app.world.remove(handle.entity,UITreeView);await tick();expect(lists.count()).toBe(0);expect(handle.getModel()).toBeUndefined();
    });
    it('collapse hides pooled text descendants and their input geometry',async()=>{
        const handle=tree();await tick();await tick();
        const label=app.world.getEntitiesWithComponents([Text]).find(e=>app.world.get(e,Text).content==='Beta')!;
        const row=app.world.get(label,Parent).entity;
        handle.getModel()!.toggle('root');await tick();await tick();
        expect(app.world.get(row,UINode).display).toBe(1);
        expect(engine.getUINodeHiddenInTree!(registry,label)).toBe(true);
        handle.getModel()!.toggle('root');await tick();await tick();
        const visible=app.world.getEntitiesWithComponents([Text]).filter(e=>app.world.get(e,Text).content==='Beta'&&!engine.getUINodeHiddenInTree!(registry,e));
        expect(visible).toHaveLength(1);
    });
    it('does not apply gameplay keyboard changes in editor mode',async()=>{
        const handle=tree();await tick();setEditorMode(true);app.getResource(FocusManager).focus(handle.entity,true);
        app.getResource(Input).keysPressed.add('ArrowDown');await tick();expect(handle.getModel()!.selectedIds).toEqual([]);
    });
    it('programmatic color changes emit once and synchronize standard fields and sliders',async()=>{
        const change=vi.fn(),handle=createColorPicker({world:app.world,events,parent:root,onChange:change});await tick();expect(change).not.toHaveBeenCalled();
        handle.setColor(col.fromHex('#61bc9080'));await tick();await tick();expect(change).toHaveBeenCalledOnce();
        const data=app.world.get(handle.entity,UIColorPicker);expect(app.world.get(data.hex,TextInput).value).toBe('#61bc9080');
        expect(app.world.get(data.alpha,UISlider).value).toBeCloseTo(128/255);expect(col.equals(app.world.get(data.preview,UIVisual).color,handle.getColor())).toBe(true);
    });
    it('hex input normalizes to the same Color and ignores incomplete input',async()=>{
        const handle=picker();await tick();const data=app.world.get(handle.entity,UIColorPicker);
        app.world.update(data.hex,TextInput,text=>{text.value='#abc';});events.emit(data.hex,'change');await tick();expect(col.toHex(handle.getColor())).toBe('#aabbcc');
        const color=handle.getColor();app.world.update(data.hex,TextInput,text=>{text.value='#xx';});events.emit(data.hex,'change');await tick();expect(handle.getColor()).toEqual(color);
    });
    it('HEX remains independently bindable when a project omits numeric channels',async()=>{
        const handle=picker();app.world.update(handle.entity,UIColorPicker,draft=>{draft.fields=[];});await tick();
        const data=app.world.get(handle.entity,UIColorPicker);
        app.world.update(data.hex,TextInput,text=>{text.value='#aabbcc';});events.emit(data.hex,'change');await tick();
        expect(col.toHex(handle.getColor())).toBe('#aabbcc');expect(app.world.get(data.hex,TextInput).value).toBe('#aabbccff');
    });
    it('preserves the editing hue at zero saturation and clamps alpha-disabled values',async()=>{
        const handle=picker();await tick();const data=app.world.get(handle.entity,UIColorPicker);
        app.world.update(data.fields[1],TextInput,text=>{text.value='0';});events.emit(data.fields[1],'change');await tick();
        app.world.update(data.fields[0],TextInput,text=>{text.value='300';});events.emit(data.fields[0],'change');await tick();
        expect(app.world.get(data.hue,UISlider).value).toBeCloseTo(300);
        app.world.update(handle.entity,UIColorPicker,picker=>{picker.alphaEnabled=false;picker.color.a=.1;});await tick();expect(handle.getColor().a).toBe(1);
    });
    it('history is per picker, bounded, and does not persist without the host',async()=>{
        const a=picker(),b=picker();await tick();const data=app.world.get(a.entity,UIColorPicker);
        events.emit(data.rememberButton,'click');await tick();events.emit(data.rememberButton,'click');await tick();
        expect(app.world.get(a.entity,UIColorPicker).history).toHaveLength(1);expect(app.world.get(b.entity,UIColorPicker).history).toHaveLength(0);
    });
    it('ignores edits and history actions on disabled controls',async()=>{
        const handle=picker();await tick();const original=handle.getColor(),data=app.world.get(handle.entity,UIColorPicker);
        app.world.insert(handle.entity,Interactable,{enabled:false,blockRaycast:true,raycastTarget:true});
        app.world.update(data.hex,TextInput,text=>{text.value='#ff0000';});events.emit(data.hex,'change');events.emit(data.rememberButton,'click');await tick();
        expect(handle.getColor()).toEqual(original);expect(app.world.get(handle.entity,UIColorPicker).history).toHaveLength(0);
    });
    it('independent prefab copies remap all picker references',async()=>{
        const prefab=widgetToPrefab(world=>createColorPicker({world,events}).entity,'ColorPicker');
        const a=await instantiatePrefab(app.world,prefab),b=await instantiatePrefab(app.world,prefab);
        const first=app.world.get(a.root,UIColorPicker),second=app.world.get(b.root,UIColorPicker);
        expect(first.hex).not.toBe(second.hex);expect(first.fields.every(e=>!second.fields.includes(e))).toBe(true);
        expect(first.sv).not.toBe(second.sv);expect(app.world.has(first.hex,TextInput)).toBe(true);
    });
});
