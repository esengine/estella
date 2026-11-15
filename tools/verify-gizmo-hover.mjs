// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';import {runElectron} from './lib/electronRun.mjs';
import {build} from 'esbuild';
import { ROOT as root } from './lib/repo.mjs';
const planOnly=process.argv.includes('--plan');
if(!process.env.CI&&!planOnly)throw Error('This editor acceptance check runs only in CI; local verification must not launch the editor.');
const out=path.join(root,'output/gizmo-hover-ci');fs.mkdirSync(out,{recursive:true});
const compiled=await build({entryPoints:[path.join(root,'desktop/src/tools/gizmo.ts')],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':path.join(root,'desktop/src')}});
const {GIZMO}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const cases=[{mode:'move',x:GIZMO.axisLen*0.65,y:0,id:'move.x',cursor:'move'},{mode:'scale',x:GIZMO.axisLen,y:0,id:'scale.x',cursor:'ew-resize'},{mode:'rotate',x:GIZMO.ringRadius,y:0,id:'rotate.z',cursor:'grab'},
  {mode:'universal',name:'universal-move',x:GIZMO.axisLen*0.65,y:0,id:'move.x',cursor:'move'},
  {mode:'universal',name:'universal-scale',x:GIZMO.universalScaleLen,y:0,id:'scale.x',cursor:'ew-resize'},
  {mode:'universal',name:'universal-rotate',x:GIZMO.ringRadius/Math.SQRT2,y:-GIZMO.ringRadius/Math.SQRT2,id:'rotate.z',cursor:'grab'}];
if(planOnly){console.log(JSON.stringify(cases));process.exit(0);}
const project=fs.mkdtempSync(path.join(out,'project-'));fs.mkdirSync(path.join(project,'assets/scenes'),{recursive:true});fs.mkdirSync(path.join(project,'src'));
fs.writeFileSync(path.join(project,'project.esproject'),JSON.stringify({formatVersion:'1',name:'Hover acceptance',defaultScene:'assets/scenes/main.esscene',spineVersion:'none'}));
fs.writeFileSync(path.join(project,'assets/scenes/main.esscene'),JSON.stringify({version:'1.0',name:'Main',entities:[{id:1,name:'Subject',parent:null,children:[],visible:true,components:[{type:'Transform',data:{position:{x:0,y:0,z:0}}},{type:'Sprite',data:{size:{x:60,y:60},color:{r:1,g:0,b:1,a:1}}}]}]}));
fs.writeFileSync(path.join(project,'src/main.ts'),'export {};');fs.writeFileSync(path.join(project,'src/components.ts'),'export {};');
const records=[];
const read="(() => { const s=document.querySelector('.viewport__stage'); return {hover:s?.dataset.gizmoHover,cursor:s?.style.cursor,size:JSON.parse(localStorage.getItem('estella.settings') || '{}')['viewport.gizmoSize'],scene:JSON.stringify(window.__estellaEditor.surface.serializeScene())}; })()";
try{
 for(const size of [0.5,1,2]) for(const c of cases){
  const name=c.name ?? c.mode;
  const run=runElectron(['.'],{via:'npx',encoding:'utf8',cwd:path.join(root,'desktop'),timeout:180000,env:{
   ESTELLA_SHOT:path.join(out,name+'-'+size+'.png'),ESTELLA_SHOT_PROJECT:project,ESTELLA_SHOT_SCENE:'assets/scenes/main.esscene',
   ESTELLA_SHOT_EVAL:`(async () => {const e=window.__estellaEditor;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const find=async selector=>{for(let i=0;i<50;i++){const node=document.querySelector(selector);if(node)return node;await wait(100);}throw Error('Missing settings control: '+selector);};e.runCommand('settings.open');const search=await find('.set-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'viewport.gizmoSize');search.dispatchEvent(new Event('input',{bubbles:true}));await wait(200);if(document.querySelectorAll('.set-content .set-row').length!==1)throw Error('Size search must identify one setting');const value=await find('.set-num');value.focus();value.value='${size}';value.blur();await wait(100);if(JSON.parse(localStorage.getItem('estella.settings')||'{}')['viewport.gizmoSize']!==${size})throw Error('Size preference was not saved');document.querySelector('.set-win').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(300);e.runCommand('mode.scene');e.runCommand('view.resetOrbit');e.surface.setGizmoDisplay({show:true,selectedOnly:true,iconSize:16,types:{}});e.surface.select(1);e.frame([1]);await wait(750);e.runCommand('tool.${c.mode}');return true;})()`,
   ESTELLA_SHOT_EDITOR_DRAG:JSON.stringify({selector:'.viewport__stage canvas',ox:c.x*size,oy:c.y*size,steps:1,hoverOnly:true,read})}});
  assert.equal(run.status,0,run.stderr);const line=run.stdout.split('\n').find(line=>line.startsWith('[editorDrag] '));assert(line,'Missing trusted hover observation');
  const result=JSON.parse(line.slice('[editorDrag] '.length));assert.equal(result.after.hover,c.id);assert.equal(result.after.cursor,c.cursor);assert.equal(result.after.size,size);assert.equal(result.after.scene,result.before.scene,'Hover edited the scene');
  assert(fs.existsSync(path.join(out,name+'-'+size+'.png')),'Missing editor screenshot');records.push({mode:c.mode,name,size,...result});
 }
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({status:'checks-passed',mode:'CI-editor-trusted-hover',records},null,2));
 console.log('Gizmo hover CI: move/scale/rotate preselection and cursors pass; scene unchanged');
}finally{if(!project.startsWith(out+path.sep))throw Error('Unexpected cleanup root');fs.rmSync(project,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
