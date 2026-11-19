// The canopy stores sky exposure in red and aerial perspective in green.
// The atlas supplies painted leaf shapes. Both coordinates remain local to the 3D foliage.
export const crownShader = `#pragma shader "Oak foliage"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_alphaCutoff float default(0.46) range(0,1)
#pragma coverage u_alphaCutoff
#pragma fragment
precision highp float;
in vec4 v_color;
in vec2 v_texCoord;
uniform sampler2D u_textures[1];
out vec4 fragColor;
void main() {
    vec4 tuft = texture(u_textures[0], v_texCoord);
    if (tuft.a < u_alphaCutoff) discard;
    float brush = dot(tuft.rgb,vec3(.24,.66,.1));
    float value = clamp(v_color.r + (brush-.31)*.37,0.,1.);
    value += .088*smoothstep(.12,.40,value)*(1.-smoothstep(.75,.96,value));
    vec3 shadow = vec3(.011,.055,.042);
    vec3 leaf = mix(shadow,vec3(.066,.236,.104),smoothstep(.04,.53,value));
    leaf = mix(leaf,vec3(.35,.59,.189),smoothstep(.37,.81,value));
    leaf = mix(leaf,vec3(.55,.76,.273),smoothstep(.73,1.,value));
    leaf *= .88 + brush*.39;
    leaf = mix(leaf,vec3(.11,.28,.266),v_color.g*.62);
    fragColor = vec4(leaf,1.);
}
#pragma end`;

export const barkShader = `#pragma shader "Weathered oak bark"
#pragma version 300 es
#pragma domain Unlit
#pragma fragment
precision highp float;
in vec4 v_color;
in vec2 v_texCoord;
out vec4 fragColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(27.451,61.317)))*43758.5453);}
float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
void main(){
    vec2 p=v_texCoord;
    float warp=noise(vec2(p.x*7.,p.y*1.8));
    float furrow=noise(vec2(p.x*42.+warp*2.2,p.y*2.8));
    float fine=noise(vec2(p.x*127.+warp*4.7,p.y*9.));
    float ridge=smoothstep(.26,.66,furrow)*.35 + fine*.08;
    vec3 stone=mix(vec3(.029,.048,.059),vec3(.182,.160,.122),clamp(v_color.r*.79+ridge-.12,0.,1.));
    stone=mix(stone,vec3(.105,.152,.075),v_color.g*.58);
    fragColor=vec4(stone,1.);
}
#pragma end`;

export const meadowPaint = `
#ifdef MESH_NORMALS
    highp vec2 g=v_worldXYZ.xz;
    float laneX=-3.0+5.0*sin(g.y*.048+.35);
    float grain=sin(g.x*21.0+sin(g.y*13.0))*sin(g.y*17.0+g.x*5.0);
    float lane=exp(-pow(abs(g.x-laneX+grain*.16)/1.34,4.0));
    lane*=smoothstep(-22.,-17.,g.y)*(1.-smoothstep(43.,49.,g.y));
    float swath=sin(g.x*.27+sin(g.y*.21))*.3+sin(g.y*.33+g.x*.13)*.22;
    float detail=dot(base.rgb,vec3(.25,.6,.15));
    vec3 grass=mix(vec3(.168,.419,.109),vec3(.302,.55,.145),clamp(.48+swath+detail*.35,0.,1.));
    vec2 turf=g*vec2(3.1,2.65);
    vec2 grid=floor(turf);
    float tuft=fract(sin(dot(grid,vec2(57.3,113.1)))*5437.2);
    vec2 cell=fract(turf)-.5;
    float mark=(1.-smoothstep(.03,.21,abs(cell.x+.39*cell.y+(tuft-.5)*.55)))*(1.-smoothstep(.08,.44,abs(cell.y)));
    grass*=.74+clamp(detail*2.28,0.,.49)+mark*(tuft-.52)*.24;
    vec3 soil=mix(vec3(.34,.287,.159),vec3(.52,.433,.266),clamp(.35+detail+grain*.12,0.,1.));
    float shade=smoothstep(.48,1.12,length((g-vec2(-10.,-32.))/vec2(28.,22.))+swath*.115);
    vec3 shadeGrass=mix(vec3(.065,.141,.095),vec3(.110,.225,.126),clamp(.55+swath+detail*.3,0.,1.));
    base.rgb=mix(shadeGrass,grass,shade);
    base.rgb=mix(base.rgb,soil*mix(.56,1.,shade),lane);
#endif
float alpha = base.a;`;

export const stonePaint = `
#ifdef MESH_NORMALS
    vec3 p=v_worldXYZ;
    float grit=sin(p.x*13.6+p.z*8.9)*sin(p.y*21.2+p.x*7.7)*sin(p.z*16.7-p.y*3.1);
    float layers=sin(p.y*10.1+p.x*.59+p.z*.78+sin(p.x*1.7+p.z*.52));
    float seam=smoothstep(.68,.97,layers)*smoothstep(-.28,.80,sin(p.x*1.2+p.z*.71));
    base.rgb*=1.06+grit*.108-seam*.22+sin(p.x*2.9+p.z*3.4)*.043;
#endif
float alpha = base.a;`;

export const grassSprigs = `#pragma shader "Meadow blade clusters"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_alphaCutoff float default(0.42) range(0,1)
#pragma coverage u_alphaCutoff
#pragma fragment
precision highp float;
in vec2 v_texCoord;
in vec4 v_color;
uniform sampler2D u_textures[1];
out vec4 fragColor;
void main(){
    vec4 blades=texture(u_textures[0],v_texCoord);
    if(blades.a<u_alphaCutoff) discard;
    float light=dot(blades.rgb,vec3(.22,.70,.08));
    vec3 green=mix(vec3(.126,.272,.055),vec3(.387,.564,.132),clamp(.19+light*.84+v_color.g*.21,0.,1.));
    fragColor=vec4(mix(vec3(.048,.115,.060),green,v_color.r),1.);
}
#pragma end`;

export const beacon = `#pragma shader "Anemo beacon"
#pragma version 300 es
#pragma domain Unlit
#pragma fragment
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
void main(){
    float x=v_texCoord.x*2.-1.;
    float core=exp(-38.*x*x);
    float halo=exp(-4.9*x*x);
    float fade=(1.-smoothstep(.63,1.,v_texCoord.y))*smoothstep(0.,.028,v_texCoord.y);
    fragColor=vec4(mix(vec3(.045,.13,1.7),vec3(.44,.76,2.8),core),(.29*core+.16*halo)*fade);
}
#pragma end`;
