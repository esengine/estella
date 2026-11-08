import { buildHud } from './hud-scene.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(path.join(root,p),'utf8'));
const write = (p,v) => writeFileSync(path.join(root,p),JSON.stringify(v,null,2)+'\n');
const rgba=(r,g,b,a=1)=>({r,g,b,a}); const vec=([x,y,z])=>({x,y,z});
const entities=[];
function add(name,components,parent=null) {
  const id=entities.length; entities.push({id,name,parent,children:[],visible:true,components});
  if(parent!==null) entities[parent].children.push(id); return id;
}
const tr=(p=[0,0,0],extra={})=>({type:'Transform',data:{position:vec(p),...extra}});
const c=(type,data)=>({type,data});
function rotation(yaw,pitch=0) {
  return {x:Math.cos(yaw/2)*Math.sin(pitch/2),y:Math.sin(yaw/2)*Math.cos(pitch/2),z:-Math.sin(yaw/2)*Math.sin(pitch/2),w:Math.cos(yaw/2)*Math.cos(pitch/2)};
}
const camera=add('Camera',[
  tr([6,1.8,13.5],{rotation:rotation(.26,-.07)}),
  c('Camera',{projectionType:0,fov:64,nearPlane:.06,farPlane:350,isActive:true,priority:0,clearFlags:3}),
  c('PostProcessVolume',{isGlobal:true,weight:1,priority:0,effects:[
    {type:'ssao',enabled:true,uniforms:{u_radius:.6,u_intensity:.8,u_bias:.04,u_power:1.2}},
    {type:'rain',enabled:true,uniforms:{u_intensity:.24,u_wetness:.2,u_wind:.08,u_speed:1.4,u_streakLength:.2,u_rippleScale:.30,u_shelterRange:40,u_puddles:.3,u_puddleScale:1.4}},
    {type:'heightFog',enabled:true,uniforms:{u_density:.012,u_heightFalloff:.028,u_baseHeight:0,u_startDistance:22,u_maxOpacity:.68,u_inscatter:0,u_skyFog:.15,u_volumetric:0},colors:{u_fogColor:rgba(.24,.34,.47)}},
    {type:'bloom',enabled:true,uniforms:{u_threshold:1.25,u_intensity:.32,u_radius:1.0}},
    {type:'colorGrade',enabled:true,uniforms:{u_exposure:.1,u_contrast:1.06,u_saturation:.96}},
    {type:'vignette',enabled:true,uniforms:{u_intensity:.16,u_softness:.8}},
    {type:'fxaa',enabled:true,uniforms:{}},
  ]}),
]);
const prefab=read('assets/models/rooftop.esprefab'); const ids=new Map();
// Scene-specific wetness tuning lives here so re-importing the model is repeatable.
// Importers may renumber materials as geometry is added. Resolve by semantic node.
const deckMaterial=prefab.entities.find(e=>e.name==='Deck_roof').components.find(c=>c.type==='MeshRenderer').data.material;
const deckMat=read(deckMaterial);
Object.assign(deckMat.properties,{u_roughness:.75,u_metallic:.5,u_specular:.9,u_clearcoat:.35,u_clearcoatRoughness:.14,u_normalMap:'../textures/roof-normal.png',u_metallicRoughnessMap:'../textures/roof-orm.png'});
write(deckMaterial,deckMat);
for(const e of prefab.entities) {
  const parent=e.name==='Tool'?camera:(e.parent===null?null:ids.get(e.parent));
  const comps=structuredClone(e.components);
  if(e.name==='Ghost') comps.find(x=>x.type==='Transform').data.position=vec([4,.06,9.5]);
  if(e.name==='World_puddle') comps.find(x=>x.type==='MeshRenderer').data.enabled=false;
  if(e.name==='Deck_roof') {
    comps.find(x=>x.type==='MeshRenderer').data.material='assets/materials/wet-roof.esmaterial';
    comps.push(c('PlanarReflection',{axis:1,clipOffset:.025,quality:1,resolutionScale:1,maxSize:2048,enabled:true}));
  }
  // The deck origin is below its upper face; lift the receiver's transform and mesh together.
  if(e.name==='Tool') Object.assign(comps.find(x=>x.type==='Transform').data,{position:vec([.51,-.10,-.65]),scale:vec([.58,.58,.58]),rotation:rotation(.28,.05)});
  ids.set(e.prefabEntityId,add(e.name,comps,parent));
}
const glove=entities.find(e=>e.name==='Glove');
const tool=entities.find(e=>e.name==='Tool');
if(glove.parent!==null) entities[glove.parent].children=entities[glove.parent].children.filter(id=>id!==glove.id);
glove.parent=tool.id;tool.children.push(glove.id);
// The filled hologram shares the placement transform and remains depth-tested.
const surface=entities.find(e=>e.name==='GhostSurface');
const ghostRoot=entities.find(e=>e.name==='Ghost');
if(surface.parent!==null) entities[surface.parent].children=entities[surface.parent].children.filter(id=>id!==surface.id);
surface.parent=ghostRoot.id;ghostRoot.children.push(surface.id);
const surfaceMesh=entities.find(e=>e.name==='GhostSurface_cyan');
const surfaceMr=surfaceMesh.components.find(x=>x.type==='MeshRenderer').data;
const surfaceMat=read(surfaceMr.material);
Object.assign(surfaceMat,{blendMode:1,depthWrite:false,cull:0});
surfaceMat.properties.u_emissive=rgba(.02,.7,.85);
write('assets/models/hologram-surface.esmaterial',surfaceMat);
Object.assign(surfaceMr,{material:'assets/models/hologram-surface.esmaterial',opaque:false,color:rgba(.03,.4,.5,.13)});
const ghostEntity=entities.find(e=>e.name==='Ghost_cyan');
const badGhost=structuredClone(ghostEntity.components);
const ghostMaterial=badGhost.find(c=>c.type==='MeshRenderer').data.material;
const invalidMaterial=read(ghostMaterial);
invalidMaterial.properties.u_emissive=rgba(4,.06,.10);
write('assets/models/invalid-placement.esmaterial',invalidMaterial);
Object.assign(badGhost.find(c=>c.type==='MeshRenderer').data,{material:'assets/models/invalid-placement.esmaterial',enabled:false});
add('Ghost_invalid',badGhost,ghostEntity.parent);
add('City ambient',[tr(),c('Light',{type:2,color:rgba(.92,.96,1),intensity:1.8,enabled:true,environment:'assets/env/rain-sky.esenv',drawEnvironment:true})]);
add('Moon fill',[tr([0,0,0],{rotation:rotation(-.3,-.65)}),c('Light',{type:1,color:rgba(.55,.72,1),intensity:.65,enabled:true,meshShadows:true,shadowExtent:45,shadowStrength:.8})]);
const point=(name,p,col,power,radius,parent=null)=>add(name,[tr(p),c('Light',{type:0,color:col,intensity:power,radius,innerRadius:.4,falloff:1.2,enabled:true})],parent);
point('Warm entrance',[.2,3,-2],rgba(1,.48,.15),2.4,9);
point('Grow bay pink',[-7,2,-2.5],rgba(1,.025,.32),1.1,8);
point('Upper grow pink',[-7,5.3,-2.5],rgba(1,.035,.4),1.1,8);
point('Canopy warm',[-6,7,-2.5],rgba(1,.55,.20),1.8,9);
point('Greenhouse worklight',[-7,3.5,-2.5],rgba(.8,1,.55),.6,6);
point('Water plant cyan',[6,2,-2],rgba(.10,.72,1),2.3,10);
point('Rooftop neon bounce',[2,2,8],rgba(.12,.5,.85),1.3,14);
point('Street magenta spill',[-5,1,7],rgba(1,.03,.32),3.2,12);
point('Billboard spill',[13,8,-12],rgba(.03,.42,1),2.5,20);
point('Tool fill',[.3,.1,-.3],rgba(.85,.88,1),2.4,3.0,camera);
for(const name of ['Warm entrance','Upper grow pink','Canopy warm']) Object.assign(entities.find(e=>e.name===name).components.find(c=>c.type==='Light').data,{meshShadows:true,shadowStrength:.75,shadowSoftness:.24});
// Ceiling fixtures illuminate downwards. A spot uses one complete shadow map;
// a point needs six faces, including directions hidden behind the fixture.
for(const name of ['Upper grow pink','Canopy warm']) {
  const fixture=entities.find(e=>e.name===name);
  Object.assign(fixture.components.find(c=>c.type==='Light').data,{type:3,innerAngle:65,outerAngle:110});
  fixture.components.find(c=>c.type==='Transform').data.rotation=rotation(0,-Math.PI/2);
}

// A small reusable build pool keeps all assets in the normal scene loading path.
for(let i=0;i<12;i++) {
  const root=add(`Built ${i}`,[tr()]);
  const piece=(name,p,s,mesh,color)=>add(`Built ${i} ${name}`,[tr(p,{scale:vec(s.map(v=>v/100))}),c('MeshRenderer',{mesh,lit:true,opaque:true,enabled:false,color})],root);
  piece('platform',[0,.30,0],[6.8,.32,4.2],'builtin:cube',rgba(.26,.34,.39));
  for(const x of [-3.3,3.3]) for(const z of [-2,2]) piece(`leg ${x} ${z}`,[x,.23,z],[.18,.46,.18],'builtin:cube',rgba(.5,.6,.65));
  piece('filter',[0,1.0,0],[.8,1.7,.8],'builtin:cylinder',rgba(.44,.56,.61));
  piece('control',[.6,.55,.1],[.5,.9,.7],'builtin:cube',rgba(.1,.18,.23));
}

// Rain and vent steam are actual runtime emitters.
const emitter=(name,p,config)=>add(name,[tr(p),c('ParticleEmitter',{texture:'assets/textures/soft.png',enabled:true,looping:true,playOnStart:true,simulationSpace:0,...config})]);
emitter('Rain',[0,13,-2],{shape:2,shapeSize:{x:34,y:1,z:28},rate:400,maxParticles:900,lifetimeMin:1.2,lifetimeMax:1.5,speedMin:0,speedMax:0,gravity:vec([1,-18,0]),startColor:rgba(.38,.69,1,.24),endColor:rgba(.38,.69,1,.04),startSizeMin:.018,startSizeMax:.028,endSizeMin:.018,endSizeMax:.028,trailEnabled:true,trailWidth:.015,trailPoints:3,trailMinDistance:.12,blendMode:1});
for(const [x,z] of [[10,-13],[-15,-5],[17,3]]) emitter('Steam '+x,[x,.5,z],{shape:3,shapeRadius:.22,shapeAngle:12,rate:9,maxParticles:70,lifetimeMin:3,lifetimeMax:5,speedMin:.35,speedMax:.7,gravity:vec([.06,.18,0]),startColor:rgba(.32,.48,.62,.13),endColor:rgba(.35,.5,.7,0),startSizeMin:.6,startSizeMax:1,endSizeMin:2.2,endSizeMax:3.1,blendMode:0});

// Author the native HUD from independently editable panel and atlas sources.
buildHud({add,tr,c,rgba,read});
write('assets/scenes/main.esscene',{version:4,name:'下城避难所',entities});
console.log(`Scene: ${entities.length} entities, ${prefab.entities.length} imported model nodes.`);
