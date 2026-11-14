// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';
if (!process.env.CI) throw Error('Editor acceptance runs only in CI; do not launch the local editor.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'output/gizmo-planes-ci');
fs.mkdirSync(out,{recursive:true});
const project=fs.mkdtempSync(path.join(out,'project-'));
fs.mkdirSync(path.join(project,'assets/scenes'),{recursive:true});fs.mkdirSync(path.join(project,'src'));
fs.writeFileSync(path.join(project,'project.esproject'),JSON.stringify({formatVersion:'1',name:'Spatial planes acceptance',defaultScene:'assets/scenes/main.esscene',spineVersion:'none'}));
fs.writeFileSync(path.join(project,'assets/scenes/main.esscene'),JSON.stringify({version:'1.0',name:'Main',entities:[{id:1,name:'Subject',parent:null,children:[],visible:true,components:[
 {type:'Transform',data:{position:{x:0,y:0,z:0}}},{type:'Sprite',data:{size:{x:60,y:60},color:{r:1,g:0,b:1,a:1}}}
]}]}));
fs.writeFileSync(path.join(project,'src/main.ts'),'export {};');fs.writeFileSync(path.join(project,'src/components.ts'),'export {};');
const read=`(async()=>{const e=window.__estellaEditor;const snap=()=>{const t=e.surface.serializeScene().entities.find(v=>v.id===1).components.find(c=>c.type==='Transform').data;return {position:t.position??{x:0,y:0,z:0},scale:t.scale??{x:1,y:1,z:1},rotation:t.rotation??{x:0,y:0,z:0,w:1}};};const pose=snap(),layout=e.gizmoLayout();if(!window.__planesRead){window.__planesRead=true;return {pose,layout};}e.surface.undo();const undone=snap();e.surface.setViewPerspective(false);e.surface.setViewOrbit(0,0);e.runCommand('tool.move');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {pose,layout,undone,flatLayout:e.gizmoLayout()};})()`;
// CSS px of GIZMO in desktop/src/tools/gizmo.ts: the view ring starts at its radius and a quarter turn ends
// that far down; a centre scale drag of one axisLen is a factor of 2.
// At gizmoSize 1.2, the store's default.
const VIEW_RING=93.6,SCALE_LENGTH=96;
const records=[];
try{
 for(const axis of ['xy','yz','zx','view','xyz','rotate-view']){
  const mode=axis==='xyz'?'scale':axis==='rotate-view'?'rotate':'move';
  const point=`(()=>{const g=window.__estellaEditor.gizmoLayout();if(!g?.spatial)throw Error('Missing spatial frame');${axis==='rotate-view'?"const r=g.rings.find(r=>r.axis==='view');if(!r)throw Error('Missing view ring');return {x:g.screen.x+r.radius,y:g.screen.y};":axis==='view'||axis==='xyz'?'return g.screen;':`const p=g.planes.find(p=>p.axis==='${axis}');if(!p)throw Error('Missing ${axis} plane');return {x:g.screen.x+p.corners.reduce((n,p)=>n+p.x,0)/4,y:g.screen.y+p.corners.reduce((n,p)=>n+p.y,0)/4};`}})()`;
  const run=runElectron(['.'],{via:'npx',encoding:'utf8',cwd:path.join(root,'desktop'),timeout:180000,env:{
   ESTELLA_SHOT:path.join(out,axis+'.png'),ESTELLA_SHOT_PROJECT:project,ESTELLA_SHOT_SCENE:'assets/scenes/main.esscene',
   ESTELLA_SHOT_EVAL:`(async()=>{const e=window.__estellaEditor;e.runCommand('mode.scene');e.runCommand('view.toggleSnapping');e.surface.setViewPerspective(true);e.surface.setViewOrbit(45,30);e.surface.select(1);e.frame([1]);await new Promise(r=>setTimeout(r,750));e.runCommand('tool.${mode}');const layout=e.gizmoLayout();if(!layout?.spatial)throw Error('Spatial view was reset before drag: '+JSON.stringify({view:e.editorView(),orbit:e.surface.viewOrbit(),layout}));return {view:e.editorView(),layout};})()`,
   ESTELLA_SHOT_EDITOR_DRAG:JSON.stringify({selector:'.viewport__stage canvas',point,dx:axis==='rotate-view'?-VIEW_RING:axis==='xyz'?SCALE_LENGTH:11,dy:axis==='rotate-view'?VIEW_RING:axis==='xyz'?0:7,captureAfter:path.join(out,axis+'-spatial.png'),read})}});
  fs.writeFileSync(path.join(out,axis+'.log'),run.stdout+'\n'+run.stderr);
  assert.equal(run.status,0,run.stderr);const line=run.stdout.split('\n').find(l=>l.startsWith('[editorDrag] '));assert(line,'Missing trusted spatial drag: '+axis+'\n'+run.stdout+'\n'+run.stderr);
  const result=JSON.parse(line.slice('[editorDrag] '.length));records.push({axis,...result});
  fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify({status:'checking',records},null,2));
  const before=result.before.pose,after=result.after.pose;
  assert(result.after.flatLayout,'Missing 2D frame after projection reset');
  assert.equal(result.after.flatLayout.spatial,false,'Tool selection restored the 3D view after switching back to 2D');
  assert.deepEqual(result.after.undone,before,'Single undo did not restore the pose');
  if(axis!=='rotate-view')assert.deepEqual(after.rotation,before.rotation,'Plane drag also rotated the subject');
  if(axis==='rotate-view'){
   assert.deepEqual(after.position,before.position);assert.deepEqual(after.scale,before.scale);
   const q=after.rotation,n=result.before.layout.normal;
   const len=Math.hypot(q.x,q.y,q.z)*Math.hypot(n.x,n.y,n.z);
   assert(len>1e-6&&Math.abs((q.x*n.x+q.y*n.y+q.z*n.z)/len)>0.9999,'Outer ring did not turn about the presented view axis');
   assert(Math.abs(2*Math.acos(Math.min(1,Math.abs(q.w)))-Math.PI/2)<0.04,'Outer ring did not turn a quarter circle');
  }else if(axis==='xyz'){
   assert.deepEqual(after.position,before.position);const s=after.scale;
   assert(s.x>1.8&&s.x<2.2,'Uniform scale missed its center handle');
   assert(Math.abs(s.x-s.y)<1e-6&&Math.abs(s.y-s.z)<1e-6,'Spatial center did not scale XYZ equally');
  }else{
   assert.deepEqual(after.scale,before.scale);const delta={x:after.position.x-before.position.x,y:after.position.y-before.position.y,z:after.position.z-before.position.z};
   if(axis==='view'){
    const n=result.before.layout.normal;assert(n,'Missing committed view normal');
    assert(Math.abs(delta.x*n.x+delta.y*n.y+delta.z*n.z)<1e-4,'Free move left the screen plane');
    assert(Math.hypot(delta.x,delta.y,delta.z)>1e-4,'Free move did nothing');
   }else for(const a of ['x','y','z']){
    if(axis.includes(a))assert(Math.abs(delta[a])>1e-4,axis+' failed to move '+a);
    else assert(Math.abs(delta[a])<1e-4,axis+' changed its constrained '+a);
   }
  }
  assert(fs.existsSync(path.join(out,axis+'.png')),'Missing restored-pose screenshot');
  assert(fs.existsSync(path.join(out,axis+'-spatial.png')),'Missing changed spatial-pose screenshot');
 }
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({status:'checks-passed',records},null,2));
 console.log('Spatial gizmos: XY/YZ/ZX, screen movement, XYZ scale, view rotation and single-step undo pass');
}finally{if(!project.startsWith(out+path.sep))throw Error('Unexpected cleanup path');fs.rmSync(project,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
