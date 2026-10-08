// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {bakeLightmap,unwrapLightmapUV,MeshChannel,MeshChannelType} from '../../sdk/dist/index.node.js';
import {writeFile} from 'node:fs/promises';
const p=[[0,-2,-2],[0,-2,2],[0,2,2],[0,2,-2]];
const vertices=new Uint8Array(4*24),v=new DataView(vertices.buffer);
p.forEach((q,i)=>{q.forEach((c,k)=>v.setFloat32(i*24+k*4,c,true));v.setFloat32(i*24+12,-1,true);});
const mesh=unwrapLightmapUV({channels:[{semantic:MeshChannel.Position,components:3,type:MeshChannelType.Float32,offset:0},{semantic:MeshChannel.Normal,components:3,type:MeshChannelType.Float32,offset:12}],vertexStride:24,vertexCount:4,vertices,indices:Uint32Array.from([0,1,2,0,2,3]),aabbMin:[0,-2,-2],aabbMax:[0,2,2]}).mesh;
const transform=Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,3,0,0,1]);
const surface={mesh,transform,albedo:[1,.3,.1]};
const light=intensity=>[{kind:'directional',direction:[1,0,0],color:[1,1,1],intensity}];
const options={atlasSize:64,texelsPerUnit:4,bounces:1,samples:64,probeSamples:256,probeGrids:[{min:[-1,0,-1],max:[1,0,1],resolution:[3,1,3]}]};
const before=bakeLightmap([surface],light(1),options).probes[0];
const times=[],fieldTimes=[]; let fresh;
for(let i=0;i<10;i++){
 let at=performance.now(); bakeLightmap([surface],light(3),{...options,probeGrids:[]});fieldTimes.push(performance.now()-at);
 at=performance.now();fresh=bakeLightmap([surface],light(3),options).probes[0];times.push(performance.now()-at);
}
const old=before.slice(), errors=[];
const error=()=>Math.sqrt(old.reduce((s,n,i)=>s+(n-fresh[i])**2,0)/old.length);
errors.push(error());
for(let i=0;i<9;i++){old.set(fresh.subarray(i*27,(i+1)*27),i*27);errors.push(error());}
const report={scope:'Research only: fresh full solve followed by one probe publication per frame; solve itself is not time sliced',probeCount:9,coeffRmsErrorPerFrame:errors,fullSolveMs:times,fieldSolveMs:fieldTimes,fullSolveMaxMs:Math.max(...times),fieldSolveMaxMs:Math.max(...fieldTimes),frameBudgetMs:16.67};
const output=process.argv.indexOf('--out');
if(output>=0) await writeFile(process.argv[output+1],JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
