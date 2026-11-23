// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { SUN_OPTICS_GLSL, CAUSTIC_ATLAS_SIDE, CAUSTIC_SLICES, CAUSTIC_RECEIVER_GLSL, WATER_ZONE_LAYER_GLSL, WATER_ZONE_LAYER_WGSL, DEFAULT_CAUSTIC_STRENGTH } from '../render/waterCaustics';

/** Stretch the reconstruction tent along the axes of the refracted cell. Its area
 * divides every light moment, preserving the integrated flux. The tent's variance
 * is twice that of a uniform source cell; one receiver texel remains the minimum. */
const FOOTPRINT_GLSL = `vec2 beamOffset(vec2 dx, vec2 dz, vec2 corner, out float area) {
    vec2 rowX = vec2(dx.x, dz.x), rowZ = vec2(dx.y, dz.y);
    float xx = dot(rowX, rowX), zz = dot(rowZ, rowZ), xz = dot(rowX, rowZ);
    float halfTrace = 0.5 * (xx + zz), radius = length(vec2(0.5 * (xx - zz), xz));
    float smaller = max(halfTrace - radius, 0.0);
    float minor = sqrt(max(1.0, 0.5 * (1.0 + smaller)));
    float major = sqrt(max(1.0, 0.5 * (1.0 + halfTrace + radius)));
    float stretch = (major - minor) / max(2.0 * radius, 1e-6);
    area = major * minor;
    return minor * corner + stretch * vec2((xx - smaller) * corner.x + xz * corner.y,
                                            xz * corner.x + (zz - smaller) * corner.y);
}`;

const FOOTPRINT_WGSL = `fn beamOffset(dx: vec2f, dz: vec2f, corner: vec2f) -> vec3f {
    let rowX = vec2f(dx.x, dz.x); let rowZ = vec2f(dx.y, dz.y);
    let xx = dot(rowX, rowX); let zz = dot(rowZ, rowZ); let xz = dot(rowX, rowZ);
    let halfTrace = 0.5 * (xx + zz); let radius = length(vec2f(0.5 * (xx - zz), xz));
    let smaller = max(halfTrace - radius, 0.0);
    let minor = sqrt(max(1.0, 0.5 * (1.0 + smaller)));
    let major = sqrt(max(1.0, 0.5 * (1.0 + halfTrace + radius)));
    let stretch = (major - minor) / max(2.0 * radius, 1e-6);
    let offset = minor * corner + stretch * vec2f((xx - smaller) * corner.x + xz * corner.y,
                                                   xz * corner.x + (zz - smaller) * corner.y);
    return vec3f(offset, major * minor);
}`;

const READ_RECEIVER_GLSL = `vec4 readReceiver(vec2 uv) {
    vec2 q = uv*u_bakeReceiverWindow.z + u_bakeReceiverWindow.xy;
    q.y = 1.0-q.y;
    vec4 fixedHit = textureLod(u_bakeReceiverDepth,q,0.0);
    if (fixedHit.r < 0.49) fixedHit.a = 0.0;
    if (u_bakeReceiverWindow.w > 0.5) {
        vec4 movingHit = textureLod(u_bakeMovingDepth,q,0.0);
        if (movingHit.a > 0.5 && (fixedHit.a < 0.5 || receiverPlaneDepth(movingHit,u_levels) < receiverPlaneDepth(fixedHit,u_levels))) return movingHit;
    }
    return fixedHit;
}`;

const RECEIVER_WGSL = `fn receiverPlaneDepth(record: vec4f) -> f32 {
    let reach = mc.u_levels.w * ${CAUSTIC_SLICES-1}.0;
    let head = max(mc.u_levels.x + mc.u_levels.y - mc.u_levels.z, 0.0) + reach * 0.01;
    let z = 2.0 * dot(record.rgb, vec3f(1.0, 1.0/255.0, 1.0/65025.0)) - 1.0;
    return z * (head + reach) - head;
}
fn readReceiver(uv: vec2f) -> vec4f {
    let q = uv*mc.u_bakeReceiverWindow.z + mc.u_bakeReceiverWindow.xy;
    let at = vec2f(q.x,1.0-q.y);
    var fixedHit = textureSampleLevel(u_bakeReceiverDepth,u_bakeReceiverDepth_s,at,0.0);
    if (fixedHit.r < 0.49) { fixedHit.a = 0.0; }
    if (mc.u_bakeReceiverWindow.w > 0.5) {
        let movingHit = textureSampleLevel(u_bakeMovingDepth,u_bakeMovingDepth_s,at,0.0);
        if (movingHit.a > 0.5 && (fixedHit.a < 0.5 || receiverPlaneDepth(movingHit) < receiverPlaneDepth(fixedHit))) { return movingHit; }
    }
    return fixedHit;
}`;

/** The first slab of the atlas holds flux at opaque hits, the second their packed depth.
 * The last slab holds the lower-resolution light field used by the volume march. */
export const CAUSTIC_PROJECTION = `#pragma shader "Water Forward Light Bundles"
#pragma version 300 es
#pragma param u_surface texture default(black) texel(data)
#pragma param u_bakeReceiverDepth texture default(black) texel(data)
#pragma param u_bakeMovingDepth texture default(black) texel(data)
#pragma param u_bakeReceiverWindow vec4 default(0,0,1,0)
#pragma param u_window vec4 default(0,0,1,1)
#pragma param u_levels vec4 default(0,1,0,1)
#pragma param u_causticStrength float default(${DEFAULT_CAUSTIC_STRENGTH})
#pragma param u_density float default(0.0012) unit(perLength)
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_causticBodyRect vec4 default(0,0,1,1)
#pragma param u_causticBodyOcean vec4 default(0,0,4,0)
#pragma param u_zoneSurfaceData texture default(white) texel(data)
#pragma param u_bakeSun vec4 default(0,1,0,0)
#pragma param u_farContrast float default(1.24)
#pragma vertex
precision highp float;
layout(location=0) in vec2 a_position;
out vec2 v_kernel;
out vec4 v_moment;
out vec2 v_tileUV;
out vec2 v_hit;
${SUN_OPTICS_GLSL}
${CAUSTIC_RECEIVER_GLSL}
${READ_RECEIVER_GLSL}
float firstHit(vec2 entry, vec2 drift, float start, float reach) {
    // Walk in light space, where even a grazing flat ray is stationary. Refine the
    // first crossing only; intersecting the bed first would miss a fish above it.
    float previous = start;
    for (int i = 0; i <= 12; ++i) {
        float d = mix(start, reach, float(i) / 12.0);
        vec2 uv = entry + drift * (d - start);
        if (any(lessThan(uv,vec2(0))) || any(greaterThanEqual(uv,vec2(1)))) break;
        vec4 record = readReceiver(uv);
        float bed = receiverPlaneDepth(record, u_levels);
        if (record.a > 0.5 && d >= bed) {
            if (i == 0) return -1e20;
            float lo = previous, hi = d;
            for (int j = 0; j < 4; ++j) {
                float mid = (lo + hi) * 0.5;
                vec2 q = entry + drift * (mid - start);
                vec4 test = readReceiver(q);
                float surface = receiverPlaneDepth(test, u_levels);
                if (test.a > 0.5 && mid >= surface) { hi = mid; bed = surface; } else lo = mid;
            }
            return clamp(bed, lo, hi);
        }
        previous = d;
    }
    return -1e20;
}
${FOOTPRINT_GLSL}
// Horizontal displacement from the entry point to a neighbour ray's impact, in world units.
// Dry source samples and receivers above this piece of water do not define a differential.
vec2 beamDrift(vec2 uv, float depth, vec2 centre) {
    vec4 field = textureLod(u_surface, uv, 0.0);
    vec2 h = clamp((field.rg * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    float vertical = u_levels.x + dot(field.ba, vec2(256.0,1.0)/257.0) * u_levels.y - u_levels.z + depth;
    vec3 normal = vec3(h.x, sqrt(max(1.0-dot(h,h), 1e-5)), h.y);
    vec3 ray = waterSunRay(u_bakeSun.xyz, normal);
    if (dot(h,h)>1.001 || vertical<0.0 || ray.y<=0.0) return centre;
    return -ray.xz * (vertical / max(ray.y,0.08));
}
void main() {
    int full = int(u_window.w), cells = full * full, coarse = full / ${CAUSTIC_ATLAS_SIDE};
    int id = gl_InstanceID;
    v_hit = vec2(0);
    if (id == cells + coarse*coarse*${CAUSTIC_SLICES}) {
        v_hit.x = -1.0;
        v_kernel = vec2(0); v_moment = vec4(0);
        v_tileUV = a_position * 0.5 + 0.5;
        gl_Position = vec4((1.0+v_tileUV.x)*(2.0/3.0)-1.0, a_position.y, 0, 1);
        return;
    }
    bool hit = id < cells;
    int n = hit ? full : coarse;
    int index = hit ? id : id-cells;
    int cell = index % (n*n), layer = index / (n*n);
    vec2 uv = (vec2(cell % n, cell / n) + 0.5) / float(n);
    vec4 field = textureLod(u_surface, uv, 0.0);
    vec2 h = clamp((field.rg * 255.0 - 128.0) / 127.0, -1.0, 1.0);
    if (dot(h,h) < 1e-9) h = vec2(0.0);
    vec3 normal = vec3(h.x, sqrt(max(1.0-dot(h,h), 1e-5)), h.y);
    float height = u_levels.x + dot(field.ba, vec2(256.0,1.0)/257.0) * u_levels.y;
    float depth = float(layer) * u_levels.w;
    vec3 sun = u_bakeSun.xyz, levelRay = waterSunRay(sun, vec3(0,1,0)), ray = waterSunRay(sun, normal);
    float airCos = dot(sun, normal);
    if (hit && airCos > 0.0 && ray.y > 0.0 && sun.y > 0.0 && u_bakeSun.w > 0.0 && dot(h,h) <= 1.001) {
        float start = u_levels.z - height;
        vec2 flatSlope = levelRay.xz / max(levelRay.y,0.08);
        vec2 drift = (flatSlope - ray.xz / max(ray.y,0.08)) / u_window.z;
        depth = firstHit(uv + flatSlope * (start / u_window.z), drift, start, ${CAUSTIC_SLICES-1}.0 * u_levels.w);
    }
    if (hit) v_hit = vec2(1.0, depth);
    float path = max(height-u_levels.z+depth, 0.0) / max(ray.y, 0.08);
    vec2 landing = uv + (levelRay.xz * depth / max(levelRay.y,0.08) - ray.xz * path) / u_window.z;
    float weight = waterSunFlux(max(airCos,0.0), max(dot(ray,normal),0.0)) * max(dot(ray,normal),0.0)
                 / max(normal.y * levelRay.y * waterSunFlux(max(sun.y,0.0),levelRay.y), 1e-6);
    if (sun.y <= 0.0 || u_bakeSun.w <= 0.0 || airCos <= 0.0 || ray.y <= 0.0 || dot(h,h)>1.001 || height-u_levels.z+depth<0.0) weight = 0.0;
    if (weight <= 0.0) {
        v_kernel = vec2(0); v_moment = vec4(0); v_tileUV = vec2(0);
        gl_Position = vec4(2,2,0,1);
        return;
    }
    vec2 ex = vec2(0.5 / float(n), 0.0), ez = ex.yx;
    vec2 centre = -ray.xz * path;
    vec2 dx = vec2(1,0) + (beamDrift(uv+ex,depth,centre) - beamDrift(uv-ex,depth,centre)) * (float(n)/u_window.z);
    vec2 dz = vec2(0,1) + (beamDrift(uv+ez,depth,centre) - beamDrift(uv-ez,depth,centre)) * (float(n)/u_window.z);
    float area;
    vec2 offset = beamOffset(dx,dz,a_position,area);
    // A separable tent integrates to one source cell. The scaled nonnegative moments
    // also work on devices whose linearly filtered, blendable target is UNORM8.
    float excessPath = path-depth/max(levelRay.y,0.08);
    if (abs(excessPath)<1e-4*u_levels.w) excessPath=0.0;
    v_moment = (weight * (32.0/255.0) / area) * vec4(1.0, ray.xz*0.5+0.5, 1.0+excessPath/(u_levels.w*16.0));
    v_kernel = a_position;
    v_tileUV = landing + offset / float(n);
    vec2 tile = vec2(layer%${CAUSTIC_ATLAS_SIDE}, layer/${CAUSTIC_ATLAS_SIDE});
    vec2 at = hit ? v_tileUV : vec2(2,0) + (tile+v_tileUV)/${CAUSTIC_ATLAS_SIDE}.0;
    gl_Position = vec4(at*vec2(2.0/3.0,2.0)-1.0,0,1);
}
#pragma end
#pragma fragment
precision highp float;
in vec2 v_kernel;
in vec4 v_moment;
in vec2 v_tileUV;
in vec2 v_hit;
out vec4 fragColor;
${CAUSTIC_RECEIVER_GLSL}
${READ_RECEIVER_GLSL}
${WATER_ZONE_LAYER_GLSL}
// The depth copy is one fragment per optical column. Keep dry and absent hits
// distinct from a wet surface with zero flux, including at the edge of a lake.
float receiverGain(vec2 uv, float depth) {
    vec3 meanRay = -refract(-u_bakeSun.xyz,vec3(0,1,0),1.0/1.333);
    vec2 at = uv - meanRay.xz * (depth / (max(meanRay.y,0.08) * u_window.z));
    if (any(lessThan(at,vec2(0))) || any(greaterThanEqual(at,vec2(1)))) return 0.0;
    vec4 surface = textureLod(u_surface, at, 0.0);
    vec2 h = (surface.rg * 255.0 - 128.0) / 127.0;
    float water = u_levels.x + dot(surface.ba,vec2(256,1)/257.0)*u_levels.y - u_levels.z + depth;
    if (dot(h,h) > 1.001 || water <= 0.0) return 0.0;
    float gain = u_causticStrength;
    if (u_causticBodyOcean.w > 0.5) {
        vec2 zone = (u_window.xy + at*u_window.z - u_causticBodyRect.xy) / u_causticBodyRect.zw;
        vec2 body = u_causticBodyOcean.xy;
        if (all(greaterThanEqual(zone,vec2(0))) && all(lessThanEqual(zone,vec2(1))))
            body = waterZoneLayer(zone,2.0).rg * vec2(u_causticBodyOcean.z,1);
        gain = gain * (1.0 - body.y) + body.x;
    }
    float extinction = dot(u_absorption.rgb,vec3(1.0/3.0)) * u_density;
    return clamp(gain,0.0,4.0) * exp(-extinction * water / max(meanRay.y,0.08));
}
void main() {
    if (any(lessThan(v_tileUV,vec2(0))) || any(greaterThanEqual(v_tileUV,vec2(1)))) discard;
    if (v_hit.x != 0.0) {
        vec4 record = readReceiver(v_tileUV);
        if (v_hit.x < 0.0) {
            if (record.a > 0.5) record.a = (128.0 + 31.75 * receiverGain(v_tileUV,receiverPlaneDepth(record,u_levels))) / 255.0;
            fragColor = record;
            return;
        }
        if (record.a < 0.5 || abs(receiverPlaneDepth(record,u_levels) - v_hit.y) > 2.5*u_window.z/u_window.w) discard;
    }
    vec2 weights = max(1.0-abs(v_kernel),0.0);
    fragColor = v_moment * weights.x * weights.y;
}
#pragma end
#pragma vertex wgsl
struct VSIn { @location(0) position: vec2f, @builtin(instance_index) instance: u32 };
struct VSOut { @builtin(position) position: vec4f, @location(0) kernel: vec2f, @location(1) moment: vec4f, @location(2) tileUV: vec2f, @location(3) hit: vec2f };
fn sunFlux(c: f32, t: f32) -> f32 {
    let rs=(c-1.333*t)/max(c+1.333*t,1e-4); let rp=(1.333*c-t)/max(1.333*c+t,1e-4);
    return c*(1.0-0.5*(rs*rs+rp*rp))/max(t,1e-4);
}
${FOOTPRINT_WGSL}
${RECEIVER_WGSL}
fn firstHit(entry: vec2f, drift: vec2f, start: f32, reach: f32) -> f32 {
    var previous = start;
    for (var i = 0; i <= 12; i++) {
        let d = mix(start,reach,f32(i)/12.0);
        let uv = entry + drift*(d-start);
        if (any(uv<vec2f(0)) || any(uv>=vec2f(1))) { break; }
        let record = readReceiver(uv);
        var bed = receiverPlaneDepth(record);
        if (record.a > 0.5 && d >= bed) {
            if (i == 0) { return -1e20; }
            var lo = previous; var hi = d;
            for (var j = 0; j < 4; j++) {
                let mid = (lo+hi)*0.5;
                let q = entry+drift*(mid-start);
                let test = readReceiver(q);
                let surface = receiverPlaneDepth(test);
                if (test.a>0.5 && mid>=surface) { hi=mid; bed=surface; } else { lo=mid; }
            }
            return clamp(bed,lo,hi);
        }
        previous=d;
    }
    return -1e20;
}
fn beamDrift(uv: vec2f, depth: f32, centre: vec2f) -> vec2f {
    let field = textureSampleLevel(u_surface, u_surface_s, uv, 0.0);
    let h = clamp((field.rg*255.0-128.0)/127.0,vec2f(-1),vec2f(1));
    let vertical = mc.u_levels.x + dot(field.ba,vec2f(256,1)/257.0)*mc.u_levels.y - mc.u_levels.z + depth;
    let normal = vec3f(h.x,sqrt(max(1.0-dot(h,h),1e-5)),h.y);
    let ray = -refract(-mc.u_bakeSun.xyz,normal,1.0/1.333);
    if (dot(h,h)>1.001 || vertical<0.0 || ray.y<=0.0) { return centre; }
    return -ray.xz * (vertical/max(ray.y,0.08));
}
@vertex fn vs_main(v: VSIn) -> VSOut {
    var out: VSOut;
    let full = u32(mc.u_window.w); let cells = full*full; let coarse = full/${CAUSTIC_ATLAS_SIDE}u;
    if (v.instance == cells + coarse*coarse*${CAUSTIC_SLICES}u) {
        out.hit.x = -1.0;
        out.tileUV = v.position*0.5+0.5;
        out.position = vec4f((1.0+out.tileUV.x)*(2.0/3.0)-1.0,-v.position.y,0,1);
        return out;
    }
    let hit = v.instance < cells; let n = select(coarse,full,hit);
    let index = select(v.instance-cells,v.instance,hit); let cell=index%(n*n); let layer=index/(n*n);
    let uv=(vec2f(f32(cell%n),f32(cell/n))+0.5)/f32(n);
    let field=textureSampleLevel(u_surface,u_surface_s,uv,0.0);
    var h=clamp((field.rg*255.0-128.0)/127.0,vec2f(-1),vec2f(1));
    if (dot(h,h)<1e-9) { h=vec2f(0); }
    let normal=vec3f(h.x,sqrt(max(1.0-dot(h,h),1e-5)),h.y);
    let height=mc.u_levels.x+dot(field.ba,vec2f(256,1)/257.0)*mc.u_levels.y;
    var depth=f32(layer)*mc.u_levels.w;
    let sun=mc.u_bakeSun.xyz; let levelRay=-refract(-sun,vec3f(0,1,0),1.0/1.333);
    let ray=-refract(-sun,normal,1.0/1.333); let c=dot(sun,normal); let t=max(dot(ray,normal),0.0);
    if (hit && c>0.0 && ray.y>0.0 && sun.y>0.0 && mc.u_bakeSun.w>0.0 && dot(h,h)<=1.001) {
        let start=mc.u_levels.z-height;
        let flatSlope=levelRay.xz/max(levelRay.y,0.08);
        depth=firstHit(uv+flatSlope*(start/mc.u_window.z),(flatSlope-ray.xz/max(ray.y,0.08))/mc.u_window.z,start,${CAUSTIC_SLICES-1}.0*mc.u_levels.w);
    }
    if (hit) { out.hit=vec2f(1.0,depth); }
    let path=max(height-mc.u_levels.z+depth,0.0)/max(ray.y,0.08);
    let land=uv+(levelRay.xz*depth/max(levelRay.y,0.08)-ray.xz*path)/mc.u_window.z;
    var weight=sunFlux(max(c,0.0),t)*t / max(normal.y*levelRay.y*sunFlux(max(sun.y,0.0),levelRay.y),1e-6);
    if(sun.y<=0.0 || mc.u_bakeSun.w<=0.0 || c<=0.0 || ray.y<=0.0 || dot(h,h)>1.001 || height-mc.u_levels.z+depth<0.0) { weight=0.0; }
    if (weight<=0.0) { out.position=vec4f(2,2,0,1); return out; }
    let ex = vec2f(0.5/f32(n),0); let ez = ex.yx; let centre = -ray.xz*path;
    let dx = vec2f(1,0) + (beamDrift(uv+ex,depth,centre)-beamDrift(uv-ex,depth,centre))*(f32(n)/mc.u_window.z);
    let dz = vec2f(0,1) + (beamDrift(uv+ez,depth,centre)-beamDrift(uv-ez,depth,centre))*(f32(n)/mc.u_window.z);
    let footprint = beamOffset(dx,dz,v.position);
    var excessPath=path-depth/max(levelRay.y,0.08);
    if (abs(excessPath)<1e-4*mc.u_levels.w) { excessPath=0.0; }
    out.moment=(weight*(32.0/255.0)/footprint.z)*vec4f(1.0,ray.xz*0.5+0.5,1.0+excessPath/(mc.u_levels.w*16.0));
    out.kernel=v.position; out.tileUV=land+footprint.xy/f32(n);
    let tile=vec2f(f32(layer%${CAUSTIC_ATLAS_SIDE}u),f32(layer/${CAUSTIC_ATLAS_SIDE}u));
    let at=select(vec2f(2,0)+(tile+out.tileUV)/${CAUSTIC_ATLAS_SIDE}.0,out.tileUV,hit);
    let p=at*vec2f(2.0/3.0,2.0)-1.0;
    out.position=vec4f(p.x,-p.y,0,1); return out;
}
#pragma end
#pragma fragment wgsl
struct FSIn { @location(0) kernel: vec2f, @location(1) moment: vec4f, @location(2) tileUV: vec2f, @location(3) hit: vec2f };
${RECEIVER_WGSL}
${WATER_ZONE_LAYER_WGSL}
fn receiverGain(uv: vec2f, depth: f32) -> f32 {
    let meanRay = -refract(-mc.u_bakeSun.xyz,vec3f(0,1,0),1.0/1.333);
    let at = uv - meanRay.xz * (depth / (max(meanRay.y,0.08) * mc.u_window.z));
    if (any(at<vec2f(0)) || any(at>=vec2f(1))) { return 0.0; }
    let surface = textureSampleLevel(u_surface,u_surface_s,at,0.0);
    let h = (surface.rg*255.0-128.0)/127.0;
    let water = mc.u_levels.x + dot(surface.ba,vec2f(256,1)/257.0)*mc.u_levels.y - mc.u_levels.z + depth;
    if (dot(h,h)>1.001 || water<=0.0) { return 0.0; }
    var gain = mc.u_causticStrength;
    if (mc.u_causticBodyOcean.w>0.5) {
        let zone = (mc.u_window.xy + at*mc.u_window.z - mc.u_causticBodyRect.xy)/mc.u_causticBodyRect.zw;
        var body = mc.u_causticBodyOcean.xy;
        if (all(zone>=vec2f(0)) && all(zone<=vec2f(1))) {
            body = waterZoneLayer(zone,2.0).rg * vec2f(mc.u_causticBodyOcean.z,1);
        }
        gain = gain*(1.0-body.y)+body.x;
    }
    let extinction = dot(mc.u_absorption.rgb,vec3f(1.0/3.0))*mc.u_density;
    return clamp(gain,0.0,4.0)*exp(-extinction*water/max(meanRay.y,0.08));
}
@fragment fn fs_main(v: FSIn) -> @location(0) vec4f {
    if(any(v.tileUV<vec2f(0)) || any(v.tileUV>=vec2f(1))) { discard; }
    if (v.hit.x != 0.0) {
        let record=readReceiver(v.tileUV);
        if (v.hit.x < 0.0) {
            if (record.a > 0.5) { return vec4f(record.rgb,(128.0+31.75*receiverGain(v.tileUV,receiverPlaneDepth(record)))/255.0); }
            return record;
        }
        if(record.a<0.5 || abs(receiverPlaneDepth(record)-v.hit.y)>2.5*mc.u_window.z/mc.u_window.w) { discard; }
    }
    let weight=max(vec2f(1)-abs(v.kernel),vec2f(0)); return v.moment*weight.x*weight.y;
}
#pragma end
`;
