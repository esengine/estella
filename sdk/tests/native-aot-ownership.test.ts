import {describe,it,expect,vi,afterEach} from 'vitest';
import {App} from '../src/app/app';
import {World} from '../src/ecs/world';
import {ResourceStorage,defineResource} from '../src/ecs/resource';
import {defineComponent} from '../src/ecs/component';
import {SystemRunner,defineSystem} from '../src/ecs/system';
import {Query,Mut} from '../src/ecs/query';
import {createNativeHeap} from '../src/ecs/bridge/nativeHeap';
import {installNativeAot,nativeAotBindings} from '../src/ecs/aot/installNativeAot';
import {engineAbiDigest,projectShapeDigest} from '../src/ecs/aot/abiDigest';
import type {AotManifest} from '../src/ecs/aot/AotSystems';
import type {ResourceReader} from '../src/ecs/aot/AotResources';
import {createMockModule} from './mocks/wasm';
afterEach(()=>vi.unstubAllGlobals());

function fixture(){
 const Drift=defineComponent('NativeLeaseDrift',{x:0}),world=new World(),runner=new SystemRunner(world,new ResourceStorage());
 const buffer=new ArrayBuffer(1<<20),live=new Set<number>(),resourceOffsets=new Map<string,number>();let next=8,resets=0,installs=0,calls=0,reject=false,contract='';
 const scope:Record<string,unknown>={es_heap:()=>buffer,es_malloc:(n:number)=>{const p=next;next+=(n+7)&~7;live.add(p);return p;},es_free:(p:number)=>{expect(live.delete(p)).toBe(true);},
 es_aot_install:()=>{installs++;return reject?-1:1;},es_aot_index:()=>0,es_aot_bound:()=>true,es_aot_script_rows:()=>true,es_aot_resource:(name:string,offset:number)=>{resourceOffsets.set(name,offset);return true;},
 es_aot_run:()=>{calls++;const p=resourceOffsets.get('NativeLeaseScore');if(p!==undefined){const view=new DataView(buffer);view.setFloat64(p,view.getFloat64(p,true)+1,true);}return 0;},es_aot_reset:()=>{resets++;resourceOffsets.clear();},es_aot_contract:()=>contract};
 const manifest:AotManifest={engineAbi:engineAbiDigest(8),projectShapes:projectShapeDigest([{name:'NativeLeaseDrift',fields:['x']}]),systems:[{name:'NativeLeaseMove',symbol:'es_sys_Move',commands:false,queries:[[{comp:'NativeLeaseDrift',mut:true}]],resources:[]}]};
 const system=defineSystem([Query(Mut(Drift))],q=>{for(const [,row]of q)row.x++;},{name:'NativeLeaseMove'});
 const install=(w=world,r=runner,m=manifest,resources?:ResourceReader)=>installNativeAot({world:w,runner:r,modulePath:'module.dll',manifest:m,heap:createNativeHeap(scope)!,bindings:nativeAotBindings(scope)!,resources});
 return{Drift,world,runner,manifest,system,install,scope,live,setReject:(v:boolean)=>reject=v,setContract:(v:string)=>contract=v,counts:()=>({resets,installs,calls})};
}
describe('native compiled runtime ownership',()=>{
 it('keeps the host-bound registry with its installed module',()=>{
  const f=fixture(), first=createMockModule(), replacement=createMockModule();
  f.world.connectCpp(first.getRegistry(),first);
  const runtime=f.install()!;
  try {
   f.runner.run(f.system);
   expect(f.counts().calls).toBe(1);
   f.world.connectCpp(replacement.getRegistry(),replacement);
   let fallback=0;
   f.runner.run(defineSystem([],()=>{fallback++;},{name:'NativeLeaseMove'}));
   expect(fallback).toBe(1);
   expect(f.counts().calls).toBe(1);
  } finally { runtime.dispose?.(); f.world.disconnectCpp(); }
 });
 it('reuses the allocation domain with existing pooled rows and retires old dispatch',()=>{
  const f=fixture(),first=f.install()!,twin=first.systems.get('NativeLeaseMove')!;const entity=f.world.spawn();f.world.insert(entity,f.Drift,{x:7});const held=f.world.get(entity,f.Drift),address=f.world.addressResolver(f.Drift)(entity);
  const second=f.install()!;first.dispose?.();expect(f.counts().resets).toBe(0);
  expect(first.dispatcherFor!(f.world).run(twin)).toBe(false);
  f.runner.run(f.system);expect(f.counts().calls).toBe(1);expect(f.world.get(entity,f.Drift)).toBe(held);expect(f.world.addressResolver(f.Drift)(entity)).toBe(address);
  second.dispose?.();second.dispose?.();f.world.releaseScriptPools();expect(f.counts().resets).toBe(1);expect(f.live.size).toBe(0);
 });
 it('revokes an older world when fresh wrappers install into the same native host',()=>{
  const f=fixture(),first=f.install()!,twin=first.systems.get('NativeLeaseMove')!,dispatch=first.dispatcherFor!(f.world);
  const other=new World(),runner=new SystemRunner(other,new ResourceStorage()),second=f.install(other,runner)!;
  expect(dispatch.run(twin)).toBe(false);expect(first.systems.size).toBe(0);first.dispose?.();expect(f.counts().resets).toBe(0);
  runner.run(f.system);expect(f.counts().calls).toBe(1);second.dispose?.();f.world.releaseScriptPools();other.releaseScriptPools();expect(f.counts().resets).toBe(1);
 });
 it('validates a refused manifest before changing the native host',()=>{
  const f=fixture(),first=f.install()!;f.setReject(false);
  expect(()=>f.install(f.world,f.runner,{...f.manifest,engineAbi:'bad'})).toThrow(/built for engine/);
  expect(f.counts().installs).toBe(1);f.runner.run(f.system);expect(f.counts().calls).toBe(1);first.dispose?.();f.world.releaseScriptPools();
 });
 it('preserves the active lease when the host refuses to load a replacement',()=>{
  const f=fixture(),first=f.install()!;f.setReject(true);expect(f.install()).toBeNull();
  f.runner.run(f.system);expect(f.counts().calls).toBe(1);expect(f.counts().resets).toBe(0);first.dispose?.();f.world.releaseScriptPools();expect(f.counts().resets).toBe(1);
 });
 it('does not select a different allocation domain when the candidate cannot load',()=>{
  const f=fixture(),first=f.install()!,otherLive=new Set<number>();let next=8;f.setReject(true);
  const heap={HEAPU8:new Uint8Array(1<<20),_malloc:(n:number)=>{const p=next;next+=(n+7)&~7;otherLive.add(p);return p;},_free:(p:number)=>{otherLive.delete(p);}};
  expect(installNativeAot({world:f.world,runner:f.runner,modulePath:'missing.dll',manifest:f.manifest,heap,bindings:nativeAotBindings(f.scope)!})).toBeNull();
  const entity=f.world.spawn();f.world.insert(entity,f.Drift,{x:7});expect(otherLive.size).toBe(0);expect(f.live.size).toBeGreaterThan(0);
  first.dispose?.();f.world.releaseScriptPools();expect(f.live.size).toBe(0);
 });
 it('reports an absent script pool after switching to a world with no rows',()=>{
  const f=fixture(),reported:Array<{name:string;rows:number}>=[];
  f.scope.es_aot_script_rows=(name:string,_sparse:number,_count:number,rows:number)=>{reported.push({name,rows});return true;};
  const first=f.install()!,entity=f.world.spawn();f.world.insert(entity,f.Drift,{x:7});f.runner.run(f.system);expect(reported.at(-1)!.rows).toBeGreaterThan(0);
  const other=new World(),runner=new SystemRunner(other,new ResourceStorage()),second=f.install(other,runner)!;runner.run(f.system);
  expect(reported.at(-1)).toEqual({name:'NativeLeaseDrift',rows:0});first.dispose?.();second.dispose?.();f.world.releaseScriptPools();other.releaseScriptPools();
 });
 it('cannot call new native code through old indices after legacy pairing refusal',()=>{
  const f=fixture(),first=f.install()!,dispatch=first.dispatcherFor!(f.world),twin=first.systems.get('NativeLeaseMove')!;f.setContract('aaaabbbbccccdddd');
  expect(()=>f.install()).toThrow(/different builds/);expect(dispatch.run(twin)).toBe(false);expect(first.systems.size).toBe(0);expect(f.counts().resets).toBe(1);
  f.runner.run(f.system);expect(f.counts().calls).toBe(0);first.dispose?.();f.world.releaseScriptPools();expect(f.counts().resets).toBe(1);
 });
 it('uses checked candidate installation to preserve the active lease on sidecar mismatch',()=>{
  const f=fixture(),contract='aaaabbbbccccdddd';f.setContract(contract);
  const checked=vi.fn((path:string,expected:string)=>expected===contract?(f.scope.es_aot_install as (p:string)=>number)(path):-1);
  f.scope.es_aot_install_checked=checked;
  const manifest={...f.manifest,moduleContract:contract},first=f.install(f.world,f.runner,manifest)!;
  expect(f.install(f.world,f.runner,{...manifest,moduleContract:'0123456789abcdef'})).toBeNull();
  expect(f.install()).toBeNull();expect(checked.mock.calls.map(c=>c[1])).toEqual([contract,'0123456789abcdef','']);
  f.runner.run(f.system);expect(f.counts().calls).toBe(1);expect(first.systems.size).toBe(1);expect(f.counts().resets).toBe(0);
  first.dispose?.();f.world.releaseScriptPools();expect(f.counts().resets).toBe(1);
 });
 it('retires mirrored resources on repeated installations without resetting the successor',()=>{
  const f=fixture(),score={value:0};
  const manifest={...f.manifest,projectShapes:projectShapeDigest([{name:'NativeLeaseDrift',fields:['x']},{name:'NativeLeaseScore',fields:['value']}]),systems:[{...f.manifest.systems[0]!,resources:[{name:'NativeLeaseScore',mut:true,fields:['value']}]}]};
  let runtime;for(let i=0;i<16;i++){
   runtime=f.install(f.world,f.runner,manifest,name=>name==='NativeLeaseScore'?score:undefined)!;
   expect(f.live.size).toBe(0);f.runner.run(f.system);expect(score.value).toBe(i+1);expect(f.live.size).toBe(1);expect(f.counts().resets).toBe(0);
  }
  runtime!.dispose?.();f.world.releaseScriptPools();expect(f.live.size).toBe(0);expect(f.counts().resets).toBe(1);
 });
 it('keeps App ownership after a refused host load and replaces live rows on success',async()=>{
  const f=fixture();for(const [key,value]of Object.entries(f.scope))vi.stubGlobal(key,value);
  const app=App.new();app.addSystem(f.system);
  try{
   expect(await app.installCompiledSystems('first.dll',f.manifest)).toBe(1);
   const entity=app.world.spawn();app.world.insert(entity,f.Drift,{x:7});await app.tick(1/60);
   f.setReject(true);expect(await app.installCompiledSystems('missing.dll',f.manifest)).toBe(0);
   expect(app.compiledSystemCount).toBe(1);await app.tick(1/60);expect(f.counts().calls).toBe(2);
   f.setReject(false);expect(await app.installCompiledSystems('next.dll',f.manifest)).toBe(1);await app.tick(1/60);expect(f.counts().calls).toBe(3);expect(f.counts().resets).toBe(0);
  }finally{app.quit({keepRenderer:true});}
  expect(f.live.size).toBe(0);expect(f.counts().resets).toBe(1);
 });
 it('cannot resurrect App dispatch when retiring native resources reenters quit',async()=>{
  const f=fixture(),app=App.new(),Score=defineResource({value:0},'NativeLeaseScore');let quit=false;
  const free=f.scope.es_free as (p:number)=>void;f.scope.es_free=(p:number)=>{free(p);if(!quit){quit=true;app.quit({keepRenderer:true});}};
  for(const [key,value]of Object.entries(f.scope))vi.stubGlobal(key,value);
  app.insertResource(Score,{value:0});app.addSystem(f.system);
  const manifest={...f.manifest,projectShapes:projectShapeDigest([{name:'NativeLeaseDrift',fields:['x']},{name:'NativeLeaseScore',fields:['value']}]),systems:[{...f.manifest.systems[0]!,resources:[{name:'NativeLeaseScore',mut:true,fields:['value']}]}]};
  try{
   await app.installCompiledSystems('first.dll',manifest);await app.tick(1/60);expect(f.live.size).toBe(1);
   await expect(app.installCompiledSystems('next.dll',manifest)).rejects.toThrow(/cancelled by App.quit/);
   expect(app.compiledSystemCount).toBe(0);expect(f.live.size).toBe(0);expect(f.counts().resets).toBe(1);
  }finally{app.quit({keepRenderer:true});}
 });
});
