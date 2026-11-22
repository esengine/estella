// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Sunlight at a water receiver, shared by the surface and underwater passes. */
import { MOST_WATER_CAUSTIC_LAYERS } from './qualitySettings/water';

export const DEFAULT_CAUSTIC_STRENGTH = 0.6;
export const MAX_CAUSTIC_STRENGTH = 4;

/** The same authoring contract for the water material, local body and underwater volume. Lengths are in reference centimetres. */
export const WATER_CAUSTICS = {
    strength: { value: DEFAULT_CAUSTIC_STRENGTH, max: MAX_CAUSTIC_STRENGTH },
    scale: { value: 200, min: 5, max: 200000 },
    speed: { value: 0.35, max: 4 },
} as const;

export const CAUSTIC_PARAMS = `#pragma param u_causticStrength float default(${WATER_CAUSTICS.strength.value}) range(0,${WATER_CAUSTICS.strength.max}) ui(slider)
#pragma param u_causticScale float default(${WATER_CAUSTICS.scale.value}) range(${WATER_CAUSTICS.scale.min},${WATER_CAUSTICS.scale.max}) ui(slider) unit(length)
#pragma param u_causticSpeed float default(${WATER_CAUSTICS.speed.value}) range(0,${WATER_CAUSTICS.speed.max}) ui(slider)`;

export const CAUSTIC_FIELD_PARAMS = `#pragma param u_causticBodyRect vec4 default(0,0,1,1)
#pragma param u_causticBodyOcean vec4 default(0,0,4,0)
#pragma param u_causticField texture default(black) texel(data)
#pragma param u_causticRect vec4 default(0,0,0,0)
#pragma param u_causticElevation vec4 default(0,1,0,0)`;

// Three filtered data layers share one sampler, including on devices with sixteen units.
// Clamp within each layer's outer texel centres so the neighbouring layer never bleeds in.
export const WATER_ZONE_LAYER_GLSL = `vec4 waterZoneLayer(vec2 uv, float layer) {
    vec2 border = vec2(0.5, 1.5) / vec2(textureSize(u_zoneSurfaceData, 0));
    vec2 at = clamp(uv, border, 1.0 - border);
    return textureLod(u_zoneSurfaceData, vec2(at.x, (at.y + layer) / 3.0), 0.0);
}`;
export const WATER_ZONE_LAYER_WGSL = `fn waterZoneLayer(uv : vec2f, layer : f32) -> vec4f {
    let border = vec2f(0.5, 1.5) / vec2f(textureDimensions(u_zoneSurfaceData, 0));
    let at = clamp(uv, border, vec2f(1.0) - border);
    return textureSampleLevel(u_zoneSurfaceData, u_zoneSurfaceData_s, vec2f(at.x, (at.y + layer) / 3.0), 0.0);
}`;

export const CAUSTIC_ATLAS_SIDE = 4;
export const CAUSTIC_SLICES = CAUSTIC_ATLAS_SIDE * CAUSTIC_ATLAS_SIDE;

export const SUN_OPTICS_GLSL = `const float WATER_IOR = 1.333;
vec3 waterSunRay(vec3 sun, vec3 normal) {
    return -refract(-sun, normal, 1.0 / WATER_IOR);
}
float waterSunFlux(float airCos, float waterCos) {
    float rs = (airCos - WATER_IOR * waterCos) / max(airCos + WATER_IOR * waterCos, 1e-4);
    float rp = (WATER_IOR * airCos - waterCos) / max(WATER_IOR * airCos + waterCos, 1e-4);
    return airCos * (1.0 - 0.5 * (rs * rs + rp * rp)) / max(waterCos, 1e-4);
}
`;

export const CAUSTICS_GLSL = `float causticHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float causticNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(causticHash(i), causticHash(i + vec2(1.0, 0.0)), f.x),
               mix(causticHash(i + vec2(0.0, 1.0)), causticHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float causticPattern(vec2 p, float t, float layers) {
    float sum = 0.0;
    float weight = 1.0;
    float norm = 0.0;
    for (int i = 0; i < ${MOST_WATER_CAUSTIC_LAYERS}; ++i) {
        if (float(i) >= layers) break;
        float s = exp2(float(i));
        float a = causticNoise(p * s + vec2(0.31, 0.12) * t * (1.0 + 0.3 * float(i)) + 7.0 * float(i));
        float b = causticNoise(p * s * 1.37 - vec2(0.17, 0.4) * t * (1.0 + 0.2 * float(i)) + 31.0 * float(i));
        float thread = max(1.0 - abs(a - b) * 3.2, 0.0);
        sum += weight * thread * thread * thread * thread;
        norm += weight;
        weight *= 0.55;
    }
    return clamp(sum / norm * 2.2, 0.0, 1.0);
}

// All positions used to address the optical field are absolute world positions. The shadow
// pass takes a render-relative receiver separately. Direction vectors point back to the sun.
${SUN_OPTICS_GLSL}
vec4 waterMoment(vec2 uv, float layer) {
    vec2 tile = vec2(mod(layer, ${CAUSTIC_ATLAS_SIDE}.0), floor(layer / ${CAUSTIC_ATLAS_SIDE}.0));
    return textureLod(u_causticField, (tile + uv) / ${CAUSTIC_ATLAS_SIDE}.0, 0.0) * (255.0 / 32.0);
}
// Coordinates refer to the receiver actually sampled by the view. The atlas stores an additive
// sum over all incident surface cells, including multiple branches at a fold.
void waterSunBundle(vec3 receiver, vec3 up, float depth, vec3 sun, vec3 meanRay, float time,
                    out vec3 ray, out float travel, out float focus) {
    ray = meanRay;
    travel = max(depth, 0.0) / max(dot(meanRay, up), 0.08);
    focus = 0.0;
    vec2 entry = receiver.xz + meanRay.xz * travel;
    if (u_causticRect.z <= 0.0) {
        // Unmanaged material previews and the explicit low-cost quality tier.
        if (u_causticRect.z == 0.0 && depth > 0.0)
            focus = causticPattern(entry / max(u_causticScale,1e-4), time*u_causticSpeed, u_causticLayers);
        return;
    }
    float planeDepth = u_causticElevation.z - receiver.y;
    float stepDepth = u_causticElevation.w;
    if (planeDepth < -stepDepth || planeDepth >= ${CAUSTIC_SLICES-1}.0 * stepDepth) return;
    vec2 uv = (receiver.xz + meanRay.xz * (max(planeDepth,0.0)/max(meanRay.y,0.08)) - u_causticRect.xy) / u_causticRect.z;
    vec2 edge = min(uv, 1.0-uv);
    float fade = smoothstep(0.025,0.09,min(edge.x,edge.y)) * (1.0-smoothstep(${CAUSTIC_SLICES-2}.0,${CAUSTIC_SLICES-1}.0,planeDepth/stepDepth));
    if (fade <= 0.0) return;
    float layer = clamp(planeDepth/stepDepth,0.0,${CAUSTIC_SLICES-1}.0);
    float base = floor(layer);
    vec4 m = mix(waterMoment(uv,base), waterMoment(uv,min(base+1.0,${CAUSTIC_SLICES-1}.0)), fract(layer));
    if (m.r <= 1e-4) return;
    vec2 horizontal = clamp(2.0*m.gb/m.r-1.0,-1.0,1.0);
    vec3 arriving = normalize(vec3(horizontal.x,sqrt(max(1.0-dot(horizontal,horizontal),1e-5)),horizontal.y));
    ray = normalize(mix(meanRay,arriving,fade));
    float projectedPath = max(planeDepth,0.0)/max(meanRay.y,0.08) + (m.a/m.r-1.0)*(16.0*stepDepth);
    travel = max(mix(travel, projectedPath, fade), 0.0);
    focus = fade * max(m.r-1.0,0.0);
}

vec3 waterReceiverLight(vec3 receiver, vec3 receiverN, vec3 up, float depth, vec3 sun, vec4 sunlight,
                         vec3 extinction, float strength, float time) {
    if (u_causticBodyOcean.w > 0.5) {
        vec2 uv = (receiver.xz - u_causticBodyRect.xy) / max(u_causticBodyRect.zw, vec2(1e-5));
        vec2 body = u_causticBodyOcean.xy;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
            body = waterZoneLayer(uv, 2.0).rg * vec2(u_causticBodyOcean.z, 1.0);
        }
        strength = strength * (1.0 - body.y) + body.x;
    }
    float airCos = dot(sun, up);
    if (airCos <= 0.0 || sunlight.a <= 0.0 || strength <= 0.0) return vec3(0.0);
    vec3 meanRay = waterSunRay(sun, up);
    vec3 ray;
    float travel, focus;
    waterSunBundle(receiver, up, depth, sun, meanRay, time, ray, travel, focus);
    return sunlight.rgb * (strength * focus * max(dot(receiverN, ray), 0.0) * waterSunFlux(airCos, dot(meanRay, up))
         * min(sunlight.a, 2.0) * 0.5) * exp(-extinction * travel);
}
`;
