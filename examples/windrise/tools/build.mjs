import {mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {MeshChannel,MeshChannelType,packChannels,encodeMesh,decodeMesh,builtinShaderTemplate} from '../../../sdk/dist/index.node.js';
import {buildGrove} from './grove.mjs';
import {crownShader,barkShader,meadowPaint,stonePaint,grassSprigs,beacon} from './landscape-materials.mjs';
import {buildFieldDetails} from './field.mjs';
import {importSdkSource} from '../../../tools/lib/sdkSource.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=transformSync(readFileSync(path.join(root,'src/world.ts'),'utf8'),{loader:'ts',format:'esm'}).code;
const {groundHeight:H,home,shrine}=await import(`data:text/javascript,${encodeURIComponent(source)}`);
function write(rel,data){
 const destination=path.join(root,rel),bytes=Buffer.isBuffer(data)?data:Buffer.from(data);
 if(existsSync(destination)&&readFileSync(destination).equals(bytes))return;
 mkdirSync(path.dirname(destination),{recursive:true});
 const temporary=destination+'.'+process.pid+'.tmp';
 writeFileSync(temporary,bytes);
 try{
  // A running editor can briefly hold its old asset open on Windows.
  for(let attempt=0;;attempt++){
   try{renameSync(temporary,destination);break;}
   catch(error){
    if(attempt>=15||!['EBUSY','EPERM','EACCES','UNKNOWN'].includes(error.code))throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
   }
  }
 }finally{if(existsSync(temporary))rmSync(temporary);}
}
const json=(rel,data)=>write(rel,JSON.stringify(data,null,2)+'\n');
function meta(rel,type){if(existsSync(path.join(root,rel+'.meta')))return;const h=createHash('sha256').update('windrise:'+rel).digest('hex');json(rel+'.meta',{uuid:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`,version:'2.0',type,importer:{}});}
let seed=129873;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const norm=v=>{let n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rgb=(r,g,b,a=1)=>({r,g,b,a});const white=rgb(1,1,1);
const entities=[];
function entity(name,components=[],parent=null){const id=entities.length;const e={id,name,parent,children:[],visible:true,components};entities.push(e);if(parent!==null)entities[parent].children.push(id);return id;}
const tr=(x=0,y=0,z=0,extra={})=>({type:'Transform',data:{position:{x,y,z},...extra}});
function material(name,shader,properties,extra={}){const rel=`assets/materials/${name}.esmaterial`;json(rel,{version:'1.0',type:'material',shader,blendMode:9,depthTest:true,depthWrite:true,cull:0,properties,...extra});meta(rel,'material');return rel;}
const toon=material('landscape','builtin:toon',{u_bands:3,u_bandSoftness:.12,u_shadeColor:rgb(.2,.31,.38),u_specThreshold:1,u_rimStrength:.08,u_rimWidth:.24,u_rimColor:rgb(.88,1,.6)});
const groundSource=builtinShaderTemplate('toon').source.replace('#pragma shader "Toon"','#pragma shader "Windrise meadow"').replace('float alpha = base.a;',meadowPaint);
const {withWgslTwin}=await importSdkSource('shaders/wgsl/twin.ts');
write('assets/materials/meadow.esshader',withWgslTwin(groundSource));meta('assets/materials/meadow.esshader','shader');
const groundMat=material('meadow','meadow.esshader',{u_bands:5,u_bandSoftness:.24,u_shadeColor:rgb(.18,.30,.31),u_specThreshold:1});
meta('assets/textures/meadow.png','texture');
function paintedMaterial(name,shader,properties={}) {
 const filename=name+'.esshader';
 write('assets/materials/'+filename,withWgslTwin(shader));
 meta('assets/materials/'+filename,'shader');
 return material(name,filename,properties);
}
const woodMaterial=paintedMaterial('oak-bark',barkShader);
const leafMaterial=paintedMaterial('oak-crown',crownShader,{u_alphaCutoff:.46});
const stoneMaterial=paintedMaterial('field-stone',builtinShaderTemplate('toon').source.replace('#pragma shader "Toon"','#pragma shader "Meadow slate"').replace('float alpha = base.a;',stonePaint),{u_bands:5,u_bandSoftness:.24,u_shadeColor:rgb(.32,.43,.49),u_specThreshold:1});
meta('assets/textures/oak-tuft.png','texture');
const grassMat=material('grass','builtin:foliage',{u_useTexture:0,u_baseColor:rgb(.18,.34,.067),u_tipColor:rgb(.36,.55,.103),u_groundNormal:.88,u_specular:0,u_tipFrom:.18,u_windStrength:.07,u_windSpeed:.85,u_windDirection:78,u_gustScale:.12,u_flutter:.02,u_translucency:.20,u_roughness:.97});
const sprigMat=paintedMaterial('meadow-sprigs',grassSprigs,{u_alphaCutoff:.42});
const glow=material('anemo','builtin:toon',{u_emissive:rgb(.18,2.4,2.1),u_shadeColor:rgb(.3,.9,.85),u_specThreshold:1,u_bands:2},{blendMode:1,depthWrite:false});
write('assets/materials/wind-light.esshader',withWgslTwin(beacon));meta('assets/materials/wind-light.esshader','shader');
const beamMat=material('wind-light','wind-light.esshader',{},{blendMode:1,depthWrite:false});
const waterMat=material('water','builtin:water',{u_waveLength:7,u_waveHeight:.04,u_waveSpeed:.6,u_waveDirection:45,u_rippleLength:.7,u_rippleStrength:.12,u_density:.65,u_foamWidth:.9,u_foamCrest:.25,u_distortionRange:12,u_fallbackDepth:2,u_roughness:.07,u_shallowColor:rgb(.12,.56,.58),u_deepColor:rgb(.025,.22,.36)},{blendMode:0,depthWrite:false});

class Mesh{
 p=[];n=[];uv=[];c=[];i=[];
 v(p,n=[0,1,0],c=[1,1,1,1],uv=[0,0]){let i=this.p.length/3;this.p.push(...p);this.n.push(...n);this.c.push(...(c.length===3?[...c,1]:c));this.uv.push(...uv);return i;}
 tri(a,b,c){this.i.push(a,b,c);}
 quad(points,color,normal){const n=normal||norm(cross(points[1].map((v,i)=>v-points[0][i]),points[2].map((v,i)=>v-points[0][i])));const ids=points.map((p,i)=>this.v(p,n,color,[[0,0],[1,0],[1,1],[0,1]][i]));this.i.push(ids[0],ids[1],ids[2],ids[0],ids[2],ids[3]);}
 save(name,mat=toon,parent=null,extra={}){if(!this.i.length)return;const rel=`assets/models/${name}.esmesh`;const {channels,vertexStride}=packChannels([{semantic:MeshChannel.Position,components:3,type:MeshChannelType.Float32},{semantic:MeshChannel.TexCoord0,components:2,type:MeshChannelType.Float32},{semantic:MeshChannel.Color,components:4,type:MeshChannelType.UNorm8},{semantic:MeshChannel.Normal,components:3,type:MeshChannelType.Float32}]);
  const count=this.p.length/3;const vertices=new Uint8Array(count*vertexStride),view=new DataView(vertices.buffer),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++){const at=i*vertexStride;for(let k=0;k<3;k++){let x=this.p[i*3+k];view.setFloat32(at+channels[0].offset+k*4,x,true);view.setFloat32(at+channels[3].offset+k*4,this.n[i*3+k],true);lo[k]=Math.min(lo[k],x);hi[k]=Math.max(hi[k],x);}for(let k=0;k<2;k++)view.setFloat32(at+channels[1].offset+k*4,this.uv[i*2+k],true);for(let k=0;k<4;k++)view.setUint8(at+channels[2].offset+k,Math.max(0,Math.min(255,Math.round(this.c[i*4+k]*255))));}
  write(rel,Buffer.from(encodeMesh({channels,vertexStride,vertexCount:count,vertices,indices:new Uint32Array(this.i),aabbMin:lo,aabbMax:hi})));meta(rel,'mesh');
  return entity(name,[tr(),{type:'MeshRenderer',data:{mesh:rel,material:mat,color:white,lit:true,opaque:true,cullBackfaces:false,castShadows:true,...extra}}],parent);
 }
}
function ellipsoid(m,p,s,col,segments=10,rings=6,flat=false){const rows=[];for(let j=0;j<=rings;j++){const th=j/rings*Math.PI,row=[];for(let k=0;k<=segments;k++){const ph=k/segments*Math.PI*2,n=[Math.sin(th)*Math.cos(ph),Math.cos(th),Math.sin(th)*Math.sin(ph)];let f=flat?1+.045*Math.sin(k*12+j*3):1;row.push(m.v(n.map((v,i)=>p[i]+v*s[i]*f),norm(n.map((v,i)=>v/s[i])),col,[k/segments,j/rings]));}rows.push(row);}for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){m.tri(rows[j][k],rows[j][k+1],rows[j+1][k+1]);m.tri(rows[j][k],rows[j+1][k+1],rows[j+1][k]);}}
function tube(m,points,radii,color,sides=10){let rings=[];for(let j=0;j<points.length;j++){const a=points[Math.max(0,j-1)],b=points[Math.min(points.length-1,j+1)],d=norm(b.map((v,i)=>v-a[i]));let u=norm(cross(d,Math.abs(d[1])>.95?[1,0,0]:[0,1,0])),v=cross(d,u);let ring=[];for(let k=0;k<=sides;k++){let angle=k/sides*Math.PI*2,n=u.map((x,i)=>x*Math.cos(angle)+v[i]*Math.sin(angle));ring.push(m.v(n.map((x,i)=>points[j][i]+x*radii[j]),n,mix(color,[.49,.40,.23],.18*(Math.sin(angle*3)+1)),[k/sides,j/(points.length-1)]));}rings.push(ring);}for(let j=0;j<rings.length-1;j++)for(let k=0;k<sides;k++){m.tri(rings[j][k],rings[j+1][k+1],rings[j][k+1]);m.tri(rings[j][k],rings[j+1][k],rings[j+1][k+1]);}}
function cylinder(m,x,y,z,r,height,col,sides=24){tube(m,[[x,y,z],[x,y+height,z]],[r,r],col,sides);let center=m.v([x,y+height,z],[0,1,0],col);for(let k=0;k<sides;k++){let a=k/sides*Math.PI*2,b=(k+1)/sides*Math.PI*2;m.tri(center,m.v([x+Math.cos(b)*r,y+height,z+Math.sin(b)*r],[0,1,0],col),m.v([x+Math.cos(a)*r,y+height,z+Math.sin(a)*r],[0,1,0],col));}}
function pathX(z){return -3+5*Math.sin(z*.048+.35);}
function pathMask(x,z){return Math.exp(-(((x-pathX(z))/1.65)**4));}

// Terrain is chunked so hidden hills do not keep the whole landscape in a draw.
for(let cz=0;cz<5;cz++)for(let cx=0;cx<5;cx++){
 const m=new Mesh(),res=48,size=80,baseX=-200+cx*size,baseZ=-230+cz*size;
 for(let z=0;z<=res;z++)for(let x=0;x<=res;x++){let px=baseX+x/res*size,pz=baseZ+z/res*size,y=H(px,pz),n=norm([H(px-.2,pz)-H(px+.2,pz),.4,H(px,pz-.2)-H(px,pz+.2)]);let variation=.5+.22*Math.sin(px*.14+pz*.07)+.2*Math.cos(pz*.17-px*.11);let col=mix([.63,.76,.57],[.98,1,.87],variation);col=mix(col,[.70,.67,.42],Math.max(0,1-Math.abs(y+1.05)/.55)*.6);m.v([px,y,pz],n,col,[px/3,pz/3]);}
 for(let z=0;z<res;z++)for(let x=0;x<res;x++){let a=z*(res+1)+x,b=a+1,c=a+res+1,d=c+1;m.tri(a,c,b);m.tri(b,c,d);}m.save(`Meadow ${cx}-${cz}`,groundMat,null,{texture:'assets/textures/meadow.png'});
}

// Layered ridges are continuous terrain profiles, with a snowy eastern peak.
for(let direction of [-1,1])for(let layer=0;layer<3;layer++){
 const m=new Mesh(),cols=240,rows=18;
 const height=(x,z)=>{let ridge=32+layer*13+13*Math.sin(x*.018+layer*4)+8*Math.sin(x*.043+layer)+3.5*Math.sin(x*.13);return Math.pow(Math.max(0,Math.sin(z*Math.PI)),.9)*ridge*.49+1.5*Math.sin(x*.21+z*32);};
 for(let j=0;j<=rows;j++)for(let k=0;k<=cols;k++){let x=-420+k/cols*840,v=j/rows,y=height(x,v)-3,z=direction*(130+layer*105+j*6);let n=norm([height(x-.5,v)-height(x+.5,v),1,-direction*(height(x,v+.01)-height(x,v-.01))/2.16]);let rock=Math.max(0,Math.min(1,(.65-n[1])*2.0));let col=mix(mix([.10,.24,.045],[.26,.39,.20],layer*.25),[.35,.38,.31],rock);col=mix(col,[.32,.48,.58],layer*.22);m.v([x,y,z],n,col,[k/cols,v]);}
 for(let j=0;j<rows;j++)for(let k=0;k<cols;k++){let a=j*(cols+1)+k,b=a+1,c=a+cols+1,d=c+1;if(direction<0){m.tri(a,b,c);m.tri(b,d,c);}else{m.tri(a,c,b);m.tri(b,c,d);}}m.save(`Distant ridge ${direction} ${layer}`);
}
// The east shoulder splits into three rock spurs below the highest ice field.
const peak=new Mesh(),spears=[[5,-223,95,2.65,2.25],[22,-230,79,2.2,2.12],[40,-216,57,1.72,1.9],[-13,-232,55,1.78,1.9]];
function mountainHeight(x,z){
 const relief=2.4*Math.sin(x*.28+z*.17)+1.4*Math.cos(x*.67-z*.31)+2.8*Math.sin(x*.12-z*.23);
 return Math.max(-2,...spears.map(([px,pz,h,wx,wz])=>{
  const dx=x-px,dz=z-pz,a=Math.atan2(dz,dx);
  return h-Math.hypot(dx*wx,dz*wz)*(.99+.17*Math.sin(a*5+.3)+.09*Math.cos(a*3))+relief;
 }));
}
const mountainPoint=(k,j)=>{const x=-80+2.5*k,z=-290+2.5*j;return [x,mountainHeight(x,z),z];};
for(let j=0;j<52;j++)for(let k=0;k<82;k++){
 const a=mountainPoint(k,j),b=mountainPoint(k+1,j),c=mountainPoint(k,j+1),d=mountainPoint(k+1,j+1);
 for(const tri of [[a,c,b],[b,c,d]]){
  const n=norm(cross(tri[1].map((v,i)=>v-tri[0][i]),tri[2].map((v,i)=>v-tri[0][i])));
  const h=tri.reduce((sum,p)=>sum+p[1]/3,0),snow=Math.max(0,Math.min(1,(h-46)/8+(n[1]-.54)*4+.26*n[0]));
  const color=mix([.235,.385,.53],[.81,.91,.99],snow);
  peak.tri(...tri.map(p=>peak.v(p,n,color)));
 }
}
peak.save('Snow peak',toon,null,{castShadows:false});

buildGrove({Mesh,H,woodMaterial,leafMaterial});
buildFieldDetails({Mesh,H,grassMat,sprigMat,toon,stoneMaterial,pathX,pathMask,shrine});
const lake=new Mesh();lake.quad([[-70,-1.06,75],[100,-1.06,75],[100,-1.06,-180],[-70,-1.06,-180]],[1,1,1,1],[0,1,0]);lake.save('Cider stream',waterMat,null,{opaque:false,castShadows:false});

// Anemo shrine, stacked carved stone and luminous inset rings.
const sx=shrine.x,sz=shrine.z,sy=H(sx,sz),stone=new Mesh(),energy=new Mesh();
for(let j=0;j<4;j++)cylinder(stone,sx,sy+j*.14,sz,2.9-j*.32,.14,[.43+j*.03,.46+j*.03,.39+j*.035]);
cylinder(stone,sx,sy+.55,sz,.72,.35,[.56,.60,.55]);cylinder(stone,sx,sy+.9,sz,.43,2.8,[.49,.55,.50],12);cylinder(stone,sx,sy+3.7,sz,.75,.16,[.60,.66,.61]);
ellipsoid(stone,[sx,sy+4.57,sz],[.32,.45,.24],[.60,.69,.65],12,7);tube(stone,[[sx,sy+3.86,sz],[sx,sy+4.4,sz]],[.55,.22],[.61,.69,.65],12);
for(let side of [-1,1])for(let j=0;j<5;j++){let reach=.45+j*.12; tube(stone,[[sx+side*.18,sy+4.5,sz],[sx+side*(.5+reach),sy+4.9+j*.19,sz+.1],[sx+side*(.75+reach),sy+5.25+j*.13,sz+.04]],[.12,.10,.005],[.67,.75,.71],6);}
const statuePrefab='assets/shrine/anemo-statue.esprefab';
if(existsSync(path.join(root,statuePrefab))){
 const prefab=JSON.parse(readFileSync(path.join(root,statuePrefab),'utf8'));
 const renderer=prefab.entities.flatMap(e=>e.components).find(c=>c.type==='MeshRenderer');
 const mesh=decodeMesh(readFileSync(path.join(root,renderer.data.mesh)));
 const factor=6.1/(mesh.aabbMax[1]-mesh.aabbMin[1]);
 const stoneMaterial=material('statue-stone','builtin:model',{u_normalMap:'assets/shrine/anemo-statue_2.png',u_roughness:.92,u_metallic:0});
 entity('Statue of the wind',[tr(sx,sy-mesh.aabbMin[1]*factor,sz,{scale:{x:factor,y:factor,z:factor},rotation:{x:0,y:-Math.SQRT1_2,z:0,w:Math.SQRT1_2}}),{...renderer,data:{...renderer.data,material:stoneMaterial,castShadows:true}}]);
 ellipsoid(energy,[sx,sy+4.25,sz+.30],[.14,.16,.14],[.2,1,.95],14,10);
}else{ellipsoid(energy,[sx,sy+4.2,sz+.45],[.19,.23,.19],[.3,1,.9],10,6);stone.save('Statue of the wind');}
energy.save('Anemo shrine glow',glow);
const beam=new Mesh();
for(let j=0;j<5;j++){
 const a=j/5*Math.PI,dx=Math.cos(a)*1.35,dz=Math.sin(a)*1.35;
 beam.quad([[sx-dx,sy+4.3,sz-dz],[sx+dx,sy+4.3,sz+dz],[sx+dx*.65,sy+19.8,sz+dz*.65],[sx-dx*.65,sy+19.8,sz-dz*.65]],[1,1,1],[0,1,0]);
}
beam.save('Anemo beacon',beamMat,null,{opaque:false,lit:false,castShadows:false});

const player=entity('Traveler',[tr(home.x,H(home.x,home.z),home.z,{rotation:{x:0,y:1,z:0,w:0}})]);
const burst=new Mesh();for(let j=0;j<3;j++){const points=[];for(let k=0;k<=64;k++){let a=k/64*Math.PI*2;points.push([Math.cos(a)*(1+j*.15),Math.sin(a*2+j)*.1+j*.16,Math.sin(a)*(1+j*.15)]);}tube(burst,points,points.map(()=>.012),[.18,1,.81],4);}burst.save('Wind burst',glow,null,{enabled:false,castShadows:false});
// The imported model stays a separate prefab so re-generation never overwrites the landscape.
const characterPrefab='assets/character/lumine-final.esprefab';
const fallbackPrefab='assets/character/lumine.esprefab';
const prefabPath=existsSync(path.join(root,characterPrefab))?characterPrefab:existsSync(path.join(root,fallbackPrefab))?fallbackPrefab:null;
if(prefabPath){
 const prefab=JSON.parse(readFileSync(path.join(root,prefabPath),'utf8'));
 const list=prefab.entities??prefab.scene?.entities??[];
 // Adding a material changes glTF's image numbering. On reimport a former
 // normal/roughness filename can now hold albedo and retain its old linear sidecar.
 for(const component of list.flatMap(e=>e.components)){
  if(component.type!=='MeshRenderer'||!component.data.texture)continue;
  const filename=component.data.texture+'.meta',sidecar=JSON.parse(readFileSync(path.join(root,filename),'utf8'));
  if(sidecar.importer.sRGB!==true){sidecar.importer.sRGB=true;json(filename,sidecar);}
 }
 const round=v=>Number(v.toFixed(7));
 const bind=list.filter(e=>e.name.startsWith('mixamorig:')).map(e=>{
  const transform=e.components.find(c=>c.type==='Transform').data,p=transform.position??{x:0,y:0,z:0},q=transform.rotation??{x:0,y:0,z:0,w:1};
  return [e.name,...[p.x,p.y,p.z,q.x,q.y,q.z,q.w].map(round)];
 });
 write('src/referencePose.ts','// Imported local bind transforms for repeatable costume photography.\nexport const referencePose: [string,number,number,number,number,number,number,number][] = [\n'+bind.map(b=>'    '+JSON.stringify(b)).join(',\n')+'\n];\n');
 const visual=entity('Lumine Visual',[tr(0,prefabPath===fallbackPrefab ? .85 : 0,0,{scale:{x:.01,y:.01,z:.01},rotation:{x:0,y:-Math.SQRT1_2,z:0,w:Math.SQRT1_2}})],player);
 const key=e=>e.prefabEntityId??e.id;
 const mapping=new Map(list.map((e,i)=>[key(e),entities.length+i]));
 const characterSource=builtinShaderTemplate('toon').source.replace('#pragma shader "Toon"','#pragma shader "Lumine silk and skin"').replace(
  'vec3 colour = base.rgb * (ambient + lit + u_shadeColor.rgb * (1.0 - lightAmount));',
  `float luma=dot(base.rgb,vec3(.26,.60,.14));
    vec3 pigment=clamp(mix(vec3(luma),base.rgb,1.10),0.,1.);
    vec3 lightTint=mix(vec3(.94,.885,.865),vec3(1.08,1.05,.97),smoothstep(.035,.75,lightAmount));
    vec3 colour=pow(pigment,vec3(1.055))*lightTint;`);
 const charMat=paintedMaterial('lumine-toon',characterSource,{u_bands:3,u_bandSoftness:.10,u_specThreshold:1,u_rimColor:rgb(1,.91,.72),u_rimStrength:.030,u_rimWidth:.16});
 for(const e of list){const copy=structuredClone(e);copy.id=mapping.get(key(e));delete copy.prefabEntityId;copy.parent=e.parent==null?visual:mapping.get(e.parent);copy.children=(e.children??[]).map(id=>mapping.get(id));
  copy.components=copy.components.filter(c=>c.type!=='TimelinePlayer');
  for(const c of copy.components){if(c.type==='MeshRenderer'){c.data.lit=true;c.data.castShadows=true;c.data.material=charMat;}if(c.type==='MeshSkin')c.data.joints=c.data.joints.map(id=>mapping.get(id));}
  if(e.parent===null&&prefabPath===characterPrefab)copy.components.push({type:'Animator',data:{controller:'assets/character/locomotion.esanimator'}});
  entities.push(copy);if(e.parent==null)entities[visual].children.push(copy.id);
 }
}
const motion=(name,loop=true,speed=1)=>({kind:'timeline',clip:`assets/character/lumine-final_${name}.estimeline`,loop,speed});
json('assets/character/locomotion.esanimator',{version:2,parameters:[{name:'speed',type:'float',default:0},{name:'grounded',type:'bool',default:true},{name:'attack',type:'trigger'}],initialState:'Locomotion',states:[
 {name:'Locomotion',motion:{kind:'blend1d',parameter:'speed',thresholds:[{value:0,motion:motion('idle')},{value:.5,motion:motion('walk',true,1.15)},{value:1,motion:motion('run',true,1.15)}]},transitions:[{to:'Airborne',conditions:[{param:'grounded',op:'false'}],duration:.12},{to:'Anemo',conditions:[{param:'attack',op:'trigger'}],duration:.15}]},
 {name:'Airborne',motion:motion('jump',false,2.5),transitions:[{to:'Locomotion',conditions:[{param:'grounded',op:'true'}],duration:.2}]},
 {name:'Anemo',motion:motion('slash',false,3.5),transitions:[{to:'Locomotion',conditions:[],hasExitTime:true,duration:.2}]}
]});meta('assets/character/locomotion.esanimator','animatorcontroller');
const quat=(yaw,pitch)=>({x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)});
const effects=[
 {type:'windriseDaylight',enabled:true,uniforms:{u_intensity:1,u_lightScene:0}},
 {type:'heightFog',enabled:true,uniforms:{u_density:.0038,u_heightFalloff:.009,u_baseHeight:0,u_startDistance:43,u_maxOpacity:.77,u_inscatter:.15,u_skyFog:.1,u_volumetric:0},colors:{u_fogColor:rgb(.30,.56,.71),u_sunColor:rgb(1,.91,.7)}},
 {type:'ssao',enabled:true,uniforms:{u_radius:.55,u_intensity:.68,u_bias:.028,u_power:1.1}},
 {type:'bloom',enabled:true,uniforms:{u_threshold:1.2,u_intensity:.14,u_radius:.85}},
 {type:'colorGrade',enabled:true,uniforms:{u_saturation:1.01,u_contrast:1.015}},
 {type:'fxaa',enabled:true,uniforms:{u_intensity:1}}
];
entity('Camera',[tr(0,2.8,25,{rotation:quat(home.yaw,home.pitch)}),{type:'Camera',data:{projectionType:0,fov:54,nearPlane:.08,farPlane:1000,isActive:true,priority:0,clearFlags:3}},{type:'PostProcessVolume',data:{isGlobal:true,priority:0,weight:1,effects}}]);
entity('Sun',[tr(0,0,0,{rotation:quat(-.9,-1.00)}),{type:'Light',data:{type:1,color:rgb(1,.96,.88),intensity:1.12,enabled:true,meshShadows:true,shadowExtent:88,shadowStrength:.68,sourceAngle:1.5}}]);
entity('Blue sky fill',[tr(),{type:'Light',data:{type:2,color:rgb(.67,.79,1),intensity:.47,enabled:true}}]);

const hud=entity('HUD',[tr(),{type:'Canvas',data:{designResolution:{x:1600,y:900},scaleMode:2,backgroundColor:rgb(0,0,0,0)}},{type:'UINode',data:{}}]);
const px=value=>({unit:0,value});
function text(name,content,x,y,w,h,size=20,color=white,align=0){return entity(name,[tr(),{type:'UINode',data:{position:1,insetLeft:px(x),insetTop:px(y),width:px(w),height:px(h)}},{type:'Text',data:{content,fontSize:size,fontFamily:'Microsoft YaHei, sans-serif',color,bold:false,align,verticalAlign:1,wordWrap:false}}],hud);}
text('Location','风 起 地',48,40,300,48,32);text('Region','蒙德  /  千风之地',50,88,260,28,16,rgb(.92,.96,.88));
text('Quest','◇  风带来了故事的种子',50,158,350,35,21,rgb(1,.94,.75));text('Objective','走近大树下的七天神像',74,195,340,28,16);
text('Compass','W                 N                 E',630,30,340,30,17,white,1);
text('Character name','荧  ·  Lv. 80',661,797,278,29,18,white,1);text('Health','━━━━━━━━━━━━━━━━━━━',634,826,330,25,20,rgb(.52,.88,.31),1);
text('Stamina','体力  100',702,855,210,25,14,rgb(1,.85,.42),1);
text('Controls','WASD  移动    Shift  冲刺    Space  跳跃    右键拖动  环视',38,851,660,30,15);
text('View controls','滚轮  缩放    V  正面    P  摄影    Home  复位',1130,852,440,28,14,white,2);
text('Skill','E',1430,730,55,55,28,white,1);text('Skill name','风涡剑',1405,784,105,25,16,white,1);
text('Interact','',610,644,380,42,22,rgb(1,.96,.79),1);
text('Status','',420,165,760,38,22,rgb(1,.97,.81),1);
json('assets/scenes/main.esscene',{version:4,name:'Windrise',entities});meta('assets/scenes/main.esscene','scene');
json('source/build-manifest.json',{seed:129873,entities:entities.length,characterPrefab:prefabPath,characterState:prefabPath?'candidate':'pending Tripo',referenceCamera:home,units:'metres'});
console.log(JSON.stringify({entities:entities.length,character:prefabPath,scene:path.join(root,'assets/scenes/main.esscene')}));
