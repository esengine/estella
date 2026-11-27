// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import{afterEach,describe,expect,it,vi}from'vitest';
import{Material,initMaterialAPI,shutdownMaterialAPI}from'../src/render/material';
import type{AssetLease}from'../src/asset/AssetLease';
const lease=(handle:number):AssetLease<{handle:number}>=>({key:'texture:'+handle,generation:handle,value:{handle},release:vi.fn(),retain:()=>null});
afterEach(()=>{shutdownMaterialAPI();vi.unstubAllGlobals();});
describe('material-owned edited textures',()=>{
  it.each([false,true])('skips queued previews after their material is disposed (core replaced: %s)',async(reconnect)=>{
    let ready=false;
    const core={HEAPU8:new Uint8Array(4),material_define:vi.fn(),material_setUniform:vi.fn(),material_setTexture:vi.fn(),material_undefine:vi.fn(),
      renderer_renderMaterialPreview:vi.fn(),renderer_pollPreviewReadback:()=>ready?1:0,renderer_getPreviewSize:()=>4,renderer_getPreviewWidth:()=>1,renderer_getPreviewHeight:()=>1,renderer_getPreviewPtr:()=>0};
    vi.stubGlobal('ImageData',class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
    initMaterialAPI(core as never);
    const first=Material.create({shader:1}),second=Material.create({shader:1});
    const pending=Material.renderPreview(first,1,1),queued=Material.renderPreview(second,1,1);
    try{
      await vi.waitFor(()=>expect(core.renderer_renderMaterialPreview).toHaveBeenCalledTimes(1));
      if(reconnect){
        shutdownMaterialAPI();initMaterialAPI({...core,renderer_renderMaterialPreview:vi.fn()}as never);
        Material.create({shader:1});expect(Material.create({shader:1})).toBe(second);
      }else Material.release(second);
    }finally{ready=true;await pending;}
    expect(await queued).toBeNull();
    expect(core.renderer_renderMaterialPreview).toHaveBeenCalledTimes(1);
  });
  it('keeps submitted texture and shader generations alive through pending preview readback',async()=>{
    let ready=false;
    const core={HEAPU8:new Uint8Array(4),material_define:vi.fn(),material_setUniform:vi.fn(),material_setTexture:vi.fn(),material_undefine:vi.fn(),
      renderer_renderMaterialPreview:vi.fn(),renderer_pollPreviewReadback:()=>ready?1:0,renderer_getPreviewSize:()=>4,renderer_getPreviewWidth:()=>1,renderer_getPreviewHeight:()=>1,renderer_getPreviewPtr:()=>0};
    vi.stubGlobal('ImageData',class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
    initMaterialAPI(core as never);const m=Material.create({shader:1}),retained=lease(11),a={...lease(11),retain:()=>retained},b=lease(22);
    const retainedProgram = lease(31), oldProgram = { ...lease(31), retain: () => retainedProgram };
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(11)}, program: { handle: 31, lease: oldProgram }},new Map([['u_albedo',a]]));
    const preview=Material.renderPreview(m,1,1);
    try{
      await vi.waitFor(()=>expect(core.renderer_renderMaterialPreview).toHaveBeenCalled());
      Material.applyState(m,{uniforms:{u_albedo:Material.tex(22)}, program: { handle: 32, lease: lease(32) }},new Map([['u_albedo',b]]));
      expect(a.release).toHaveBeenCalledTimes(1);expect(retained.release).not.toHaveBeenCalled();
      expect(oldProgram.release).toHaveBeenCalledTimes(1);
      expect(retainedProgram.release).not.toHaveBeenCalled();
    }finally{ready=true;await preview;}
    expect(retained.release).toHaveBeenCalledTimes(1);
    expect(retainedProgram.release).toHaveBeenCalledTimes(1);
  });
  it('holds transferred textures through scalar edits and releases replacements after the GPU update',()=>{
    const m=Material.create({shader:1}),a=lease(11),b=lease(22);
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(11)}},new Map([['u_albedo',a]]));
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(11),u_value:2}});
    expect(a.release).not.toHaveBeenCalled();
    const core={material_define:vi.fn(),material_setUniform:vi.fn(),material_setTexture:vi.fn(),material_undefine:vi.fn()};
    initMaterialAPI(core as never);
    vi.mocked(a.release).mockImplementation(()=>expect(core.material_setTexture).toHaveBeenCalledWith(m,'u_albedo',22));
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(22)}},new Map([['u_albedo',b]]));
    expect(a.release).toHaveBeenCalledTimes(1);expect(b.release).not.toHaveBeenCalled();
    Material.release(m);expect(b.release).toHaveBeenCalledTimes(1);
  });
  it('releases Reset and direct uniform replacements and consumes unmatched receipts',()=>{
    const m=Material.create({shader:1}),a=lease(11),b=lease(22),unused=lease(33);
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(11)}},new Map([['u_albedo',a],['missing',unused]]));
    expect(unused.release).toHaveBeenCalledTimes(1);
    Material.setUniform(m,'u_albedo',Material.tex(22));expect(a.release).toHaveBeenCalledTimes(1);
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(22)}},new Map([['u_albedo',b]]));
    Material.applyState(m,{});expect(b.release).toHaveBeenCalledTimes(1);
  });
  it('cleans every material even when a release throws',()=>{
    const a=lease(11),b=lease(22),m=Material.create({shader:1}),n=Material.create({shader:1});
    Material.applyState(m,{uniforms:{u_albedo:Material.tex(11)}},new Map([['u_albedo',a]]));
    Material.applyState(n,{uniforms:{u_albedo:Material.tex(22)}},new Map([['u_albedo',b]]));
    vi.mocked(a.release).mockImplementation(()=>{throw Error('release failed');});
    const cleanup=Material.releaseAll;
    expect(cleanup).toThrow('release failed');expect(b.release).toHaveBeenCalledTimes(1);
    expect(Material.isValid(m)).toBe(false);expect(Material.isValid(n)).toBe(false);
  });
});
