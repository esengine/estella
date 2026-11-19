// Keep linear animation curves within 0.0002 component units of the imported samples.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reduce=(keys,tolerance)=>{
 if(keys.length<3)return keys;
 const kept=new Set([0,keys.length-1]),work=[[0,keys.length-1]];
 while(work.length){const [a,b]=work.pop();let index=-1,error=tolerance;
  for(let i=a+1;i<b;i++){const f=(keys[i].time-keys[a].time)/(keys[b].time-keys[a].time);const e=Math.abs(keys[i].value-(keys[a].value+(keys[b].value-keys[a].value)*f));if(e>error){error=e;index=i;}}
  if(index>=0){kept.add(index);work.push([a,index],[index,b]);}
 }
 return [...kept].sort((a,b)=>a-b).map(i=>keys[i]);
};
const report=[];
for(const name of ['idle','walk','run','jump','slash']){
 const file=path.join(root,`assets/character/lumine-final_${name}.estimeline`),original=readFileSync(file,'utf8'),clip=JSON.parse(original);
 let before=0,after=0,maxError=0;
 for(const track of clip.tracks)for(const channel of track.channels??[]){
  const keys=channel.keyframes;if(!keys?.length||keys.some(k=>k.interpolation!=='linear'))continue;
  const reduced=reduce(keys,.0002);before+=keys.length;after+=reduced.length;
  let j=0;for(const key of keys){while(j<reduced.length-2&&reduced[j+1].time<key.time)j++;const a=reduced[j],b=reduced[Math.min(j+1,reduced.length-1)];const v=a.value+(b.value-a.value)*(b.time===a.time?0:(key.time-a.time)/(b.time-a.time));maxError=Math.max(maxError,Math.abs(key.value-v));}
  if(maxError>.00020001)throw Error('Animation error bound exceeded');channel.keyframes=reduced;
 }
 const compact=JSON.stringify(clip)+'\n';writeFileSync(file,compact);report.push({name,before,after,maxError,bytesBefore:original.length,bytesAfter:compact.length});
}
writeFileSync(path.join(root,'source/animation-compression.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
