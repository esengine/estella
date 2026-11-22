// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { SUN_OPTICS_GLSL, CAUSTIC_ATLAS_SIDE } from '../render/waterCaustics';

/** Depth slices in a refracted-light coordinate system. Neighbouring slices can
 * be interpolated without translating a whole caustic by the flat ray's horizontal travel. */
export const CAUSTIC_PROJECTION = `#pragma shader "Water Forward Light Bundles"
#pragma version 300 es
#pragma param u_surface texture default(black) texel(data)
#pragma param u_window vec4 default(0,0,1,1)
#pragma param u_levels vec4 default(0,1,0,1)
#pragma param u_bakeSun vec4 default(0,1,0,0)
#pragma vertex
precision highp float;
layout(location=0) in vec2 a_position;
out vec2 v_kernel;
out vec4 v_moment;
out vec2 v_tileUV;
${SUN_OPTICS_GLSL}
void main() {
    int n = int(u_window.w);
    int cell = gl_InstanceID % (n*n), layer = gl_InstanceID / (n*n);
    vec2 uv = (vec2(cell % n, cell / n) + 0.5) / float(n);
    vec4 field = textureLod(u_surface, uv, 0.0);
    vec2 h = clamp((field.rg * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    if (dot(h,h) < 1e-9) h = vec2(0.0);
    vec3 normal = vec3(h.x, sqrt(max(1.0-dot(h,h), 1e-5)), h.y);
    float height = u_levels.x + dot(field.ba, vec2(256.0,1.0)/257.0) * u_levels.y;
    float depth = float(layer) * u_levels.w;
    vec3 sun = u_bakeSun.xyz, levelRay = waterSunRay(sun, vec3(0,1,0)), ray = waterSunRay(sun, normal);
    float airCos = dot(sun, normal);
    float path = max(height-u_levels.z+depth, 0.0) / max(ray.y, 0.08);
    vec2 landing = uv + (levelRay.xz * depth / max(levelRay.y,0.08) - ray.xz * path) / u_window.z;
    float weight = waterSunFlux(max(airCos,0.0), max(dot(ray,normal),0.0)) * max(dot(ray,normal),0.0)
                 / max(normal.y * levelRay.y * waterSunFlux(max(sun.y,0.0),levelRay.y), 1e-6);
    if (sun.y <= 0.0 || u_bakeSun.w <= 0.0 || airCos <= 0.0 || ray.y <= 0.0 || dot(h,h)>1.001 || height-u_levels.z+depth<0.0) weight = 0.0;
    // A separable tent integrates to one source cell. The scaled nonnegative moments
    // also work on devices whose linearly filtered, blendable target is UNORM8.
    float excessPath = path-depth/max(levelRay.y,0.08);
    if (abs(excessPath)<1e-4*u_levels.w) excessPath=0.0;
    v_moment = (weight * 32.0/255.0) * vec4(1.0, ray.xz*0.5+0.5, 1.0+excessPath/(u_levels.w*16.0));
    v_kernel = a_position;
    v_tileUV = landing + a_position / float(n);
    vec2 tile = vec2(layer%${CAUSTIC_ATLAS_SIDE}, layer/${CAUSTIC_ATLAS_SIDE});
    gl_Position = vec4((tile+v_tileUV)*(2.0/${CAUSTIC_ATLAS_SIDE}.0)-1.0,0.0,1.0);
}
#pragma end
#pragma fragment
precision highp float;
in vec2 v_kernel;
in vec4 v_moment;
in vec2 v_tileUV;
out vec4 fragColor;
void main() {
    if (any(lessThan(v_tileUV,vec2(0))) || any(greaterThanEqual(v_tileUV,vec2(1)))) discard;
    vec2 weights = max(1.0-abs(v_kernel),0.0);
    fragColor = v_moment * weights.x * weights.y;
}
#pragma end
#pragma vertex wgsl
struct VSIn { @location(0) position: vec2f, @builtin(instance_index) instance: u32 };
struct VSOut { @builtin(position) position: vec4f, @location(0) kernel: vec2f, @location(1) moment: vec4f, @location(2) tileUV: vec2f };
fn sunFlux(c: f32, t: f32) -> f32 {
    let rs=(c-1.333*t)/max(c+1.333*t,1e-4); let rp=(1.333*c-t)/max(1.333*c+t,1e-4);
    return c*(1.0-0.5*(rs*rs+rp*rp))/max(t,1e-4);
}
@vertex fn vs_main(v: VSIn) -> VSOut {
    var out: VSOut;
    let n=u32(mc.u_window.w); let cell=v.instance%(n*n); let layer=v.instance/(n*n);
    let uv=(vec2f(f32(cell%n),f32(cell/n))+0.5)/f32(n);
    let field=textureSampleLevel(u_surface,u_surface_s,uv,0.0);
    var h=clamp((field.rg*255.0-128.0)/127.0,vec2f(-1),vec2f(1));
    if (dot(h,h)<1e-9) { h=vec2f(0); }
    let normal=vec3f(h.x,sqrt(max(1.0-dot(h,h),1e-5)),h.y);
    let height=mc.u_levels.x+dot(field.ba,vec2f(256,1)/257.0)*mc.u_levels.y;
    let depth=f32(layer)*mc.u_levels.w;
    let sun=mc.u_bakeSun.xyz; let levelRay=-refract(-sun,vec3f(0,1,0),1.0/1.333);
    let ray=-refract(-sun,normal,1.0/1.333); let c=dot(sun,normal); let t=max(dot(ray,normal),0.0);
    let path=max(height-mc.u_levels.z+depth,0.0)/max(ray.y,0.08);
    let land=uv+(levelRay.xz*depth/max(levelRay.y,0.08)-ray.xz*path)/mc.u_window.z;
    var weight=sunFlux(max(c,0.0),t)*t / max(normal.y*levelRay.y*sunFlux(max(sun.y,0.0),levelRay.y),1e-6);
    if(sun.y<=0.0 || mc.u_bakeSun.w<=0.0 || c<=0.0 || ray.y<=0.0 || dot(h,h)>1.001 || height-mc.u_levels.z+depth<0.0) { weight=0.0; }
    var excessPath=path-depth/max(levelRay.y,0.08);
    if (abs(excessPath)<1e-4*mc.u_levels.w) { excessPath=0.0; }
    out.moment=weight*(32.0/255.0)*vec4f(1.0,ray.xz*0.5+0.5,1.0+excessPath/(mc.u_levels.w*16.0));
    out.kernel=v.position; out.tileUV=land+v.position/f32(n);
    let p=(vec2f(f32(layer%${CAUSTIC_ATLAS_SIDE}u),f32(layer/${CAUSTIC_ATLAS_SIDE}u))+out.tileUV)*(2.0/${CAUSTIC_ATLAS_SIDE}.0)-1.0;
    out.position=vec4f(p.x,-p.y,0,1); return out;
}
#pragma end
#pragma fragment wgsl
struct FSIn { @location(0) kernel: vec2f, @location(1) moment: vec4f, @location(2) tileUV: vec2f };
@fragment fn fs_main(v: FSIn) -> @location(0) vec4f {
    if(any(v.tileUV<vec2f(0)) || any(v.tileUV>=vec2f(1))) { discard; }
    let weight=max(vec2f(1)-abs(v.kernel),vec2f(0)); return v.moment*weight.x*weight.y;
}
#pragma end
`;
