import {defineSkyEffect} from 'esengine';

// A spherical sky, with lobed cumulus banks in world directions. The same field is
// sampled by reflections and the camera, also when the traveler looks behind her.
const glsl = `
float cloudHash(vec2 p) {
    vec3 q=fract(vec3(p.xyx)*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
}
float cloudNoise(vec2 p) {
    vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),
               mix(cloudHash(i+vec2(0,1)),cloudHash(i+1.),f.x),f.y);
}
float cloudBank(vec2 p,vec2 c,vec2 radii) {
    float azimuth=fract((p.x-c.x)*.1591549431+.5)*6.283185307-3.141592654;
    vec2 d=vec2(azimuth,p.y-c.y)/radii;
    return dot(d,d);
}
vec3 skyRadiance(vec3 dir,vec3 sun,vec3 sunColor,float env) {
    vec2 p=vec2(atan(dir.x,-dir.z),asin(clamp(dir.y,-1.,1.)));
    vec3 blue=mix(vec3(.35,.65,.79),vec3(.013,.149,.448),smoothstep(-.05,.38,p.y));
    blue=mix(blue,vec3(.009,.117,.364),smoothstep(.4,1.15,p.y));
    float field=min(cloudBank(p,vec2(-.44,.475),vec2(.205,.089)),cloudBank(p,vec2(-.565,.321),vec2(.032,.017)));
    field=min(field,cloudBank(p,vec2(.15,.285),vec2(.12,.050)));
    field=min(field,cloudBank(p,vec2(.72,.34),vec2(.32,.104)));
    field=min(field,cloudBank(p,vec2(-1.62,.29),vec2(.45,.12)));
    field=min(field,cloudBank(p,vec2(2.74,.37),vec2(.57,.13)));
    field=min(field,cloudBank(p,vec2(1.74,.54),vec2(.26,.09)));
    vec3 disc=(1.-env)*sunColor*smoothstep(.99962,.99994,dot(dir,sun))*1.6;
    if(field>2.25) return blue+disc;
    vec2 q=p*vec2(48.,62.);
    float billow=cloudNoise(q)*.49+cloudNoise(q*2.13+7.1)*.25+cloudNoise(q*4.31)*.13+cloudNoise(q*9.26)*.06;
    float shell=sqrt(field)+billow*.88-.43;
    float density=1.-smoothstep(.91,1.06,shell);
    float rim=smoothstep(.20,1.03,shell*.59+billow*.62+max(0.,p.y)*.42);
    vec3 cloud=mix(vec3(.50,.68,.92),vec3(.97,1.03,1.08),rim);
    vec3 sky=mix(blue,cloud,density);
    return sky+disc;
}`;

const wgsl = `
fn cloudHash(p:vec2f)->f32 {
    var q=fract(p.xyx*.1031); q=q+dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
}
fn cloudNoise(p:vec2f)->f32 {
    let i=floor(p); var f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(cloudHash(i),cloudHash(i+vec2f(1,0)),f.x),
               mix(cloudHash(i+vec2f(0,1)),cloudHash(i+1.),f.x),f.y);
}
fn cloudBank(p:vec2f,c:vec2f,radii:vec2f)->f32 {
    let azimuth=fract((p.x-c.x)*.1591549431+.5)*6.283185307-3.141592654;
    let d=vec2f(azimuth,p.y-c.y)/radii;
    return dot(d,d);
}
fn skyRadiance(dir:vec3f,sun:vec3f,sunColor:vec3f,env:f32)->vec3f {
    let p=vec2f(atan2(dir.x,-dir.z),asin(clamp(dir.y,-1.,1.)));
    var blue=mix(vec3f(.35,.65,.79),vec3f(.013,.149,.448),smoothstep(-.05,.38,p.y));
    blue=mix(blue,vec3f(.009,.117,.364),smoothstep(.4,1.15,p.y));
    var field=min(cloudBank(p,vec2f(-.44,.475),vec2f(.205,.089)),cloudBank(p,vec2f(-.565,.321),vec2f(.032,.017)));
    field=min(field,cloudBank(p,vec2f(.15,.285),vec2f(.12,.050)));
    field=min(field,cloudBank(p,vec2f(.72,.34),vec2f(.32,.104)));
    field=min(field,cloudBank(p,vec2f(-1.62,.29),vec2f(.45,.12)));
    field=min(field,cloudBank(p,vec2f(2.74,.37),vec2f(.57,.13)));
    field=min(field,cloudBank(p,vec2f(1.74,.54),vec2f(.26,.09)));
    let disc=(1.-env)*sunColor*smoothstep(.99962,.99994,dot(dir,sun))*1.6;
    if(field>2.25){return blue+disc;}
    let q=p*vec2f(48.,62.);
    let billow=cloudNoise(q)*.49+cloudNoise(q*2.13+7.1)*.25+cloudNoise(q*4.31)*.13+cloudNoise(q*9.26)*.06;
    let shell=sqrt(field)+billow*.88-.43;
    let density=1.-smoothstep(.91,1.06,shell);
    let rim=smoothstep(.20,1.03,shell*.59+billow*.62+max(0.,p.y)*.42);
    let cloud=mix(vec3f(.50,.68,.92),vec3f(.97,1.03,1.08),rim);
    let sky=mix(blue,cloud,density);
    return sky+disc;
}`;

export function installWindriseSky() {
    defineSkyEffect({type:'windriseDaylight',label:'Windrise daylight',glsl,wgsl,still:true});
}
