// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Disposable authored game fixture; no test controls enter the original example. */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import { toolArgs } from '../lib/toolArgs.mjs';
const ARGS=toolArgs({wasm:null,out:null});
if(!ARGS.wasm||!ARGS.out)throw Error('Expected --wasm <runtime> --out <export>');
const workspace=process.cwd(),output=path.resolve(workspace,'output');fs.mkdirSync(output,{recursive:true});
const temporary=fs.mkdtempSync(path.join(output,'execution-hold-source-'));
try {
    const source=path.join(workspace,'examples/mobile-controls'),project=path.join(temporary,'game');
    fs.cpSync(source,project,{recursive:true,filter:file=>!path.relative(source,file).split(path.sep).some(part=>part.startsWith('dist-')||part==='.esengine')});
    const media='assets/execution-probe.mp4';
    fs.copyFileSync(path.join(workspace,'fixtures/scenes/video-playback.mp4'),path.join(project,media));
    fs.copyFileSync(path.join(workspace,'examples/video-playback/assets/video/clip.mp4.meta'),path.join(project,media+'.meta'));
    const scenePath=path.join(project,'assets/scenes/main.esscene'),scene=JSON.parse(fs.readFileSync(scenePath,'utf8'));
    scene.entities.push({id:Math.max(...scene.entities.map(entity=>entity.id))+1,name:'ExecutionMediaAsset',parent:null,children:[],visible:false,
        components:[{type:'Video',data:{source:media,enabled:false,autoplay:false,muted:true}}]});
    fs.writeFileSync(scenePath,JSON.stringify(scene));
    fs.appendFileSync(path.join(project,'src/main.ts'),`
import {addPlugin as fixturePlugin,createButton as fixtureButton,UIEvents as FixtureEvents,Res as FixtureRes,
    GetWorld as FixtureWorld,defineSystem as fixtureSystem,Schedule as FixtureSchedule,Time as FixtureTime,
    VideoPlayer as FixtureVideo,type VideoHandle as FixtureVideoHandle} from 'esengine';
fixturePlugin({name:'ExecutionHoldFixture',build(app){
    const state={app,clicks:0,probe:0,video:null as FixtureVideoHandle|null};
    (window as unknown as {__executionFixture:unknown}).__executionFixture=state;
    app.addSystemToSchedule(FixtureSchedule.Startup,fixtureSystem([FixtureRes(FixtureEvents),FixtureWorld()],(events,world)=>{
        const parent=world.findEntityByName('Canvas');if(parent===null)throw Error('Fixture canvas missing');
        const button=fixtureButton({world,events,parent,userGesture:true,text:'PROBE',
            node:{position:UIPositionType.Absolute,insetLeft:px(360),insetTop:px(346),width:px(90),height:px(36)},
            onClick:()=>{state.clicks++;if(!state.video)state.video=app.getResource(FixtureVideo).play(${JSON.stringify(media)},{muted:true,loop:true});}});
        state.probe=button.entity;world.insert(button.entity,Name,{value:'ExecutionProbe'});
    }));
}});
`);
    execFileSync(process.execPath,['pipeline/bin/estella.mjs','export',project,'--platform','web','--wasm',path.resolve(ARGS.wasm),'--out',path.resolve(ARGS.out)],{cwd:workspace,stdio:'inherit',windowsHide:true});
} finally {
    const resolved=path.resolve(temporary);
    if(path.dirname(resolved)!==output||!path.basename(resolved).startsWith('execution-hold-source-'))throw Error('Unsafe temporary source path');
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:50});
}
