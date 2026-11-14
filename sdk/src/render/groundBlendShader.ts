// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  groundBlendShader.ts
 * @brief The Model shader, for a rock, a kerb or a foundation that has to stand in the ground rather than on it.
 *
 * @details Where the surface comes close to what stands behind it, it gives way to the picture of that very pixel, so whatever
 *          the ground is drawn with, its layers, its light and its shadows are what the seam fades into, with nothing baked and
 *          nothing to keep in step. The same closeness can bring a second layer up the surface (dirt climbing a rock), and a
 *          vertex colour's red can paint that layer by hand. How close is measured as height above what is behind, not along the
 *          view, so the band does not widen and narrow as the camera tilts.
 *
 *          Derived from Model, so a material moved onto it keeps every map and param it had. Such a material is drawn after a copy
 *          of the opaque scene is taken, which is the whole of its cost.
 */

/** The fade and the second layer, added to Model's params. */
const PARAMS = `// How high above what stands behind it the surface has fully arrived, in world units. 0 leaves a hard edge.
#pragma param u_blendDistance float default(30) range(0,100000) ui(slider)
// How much the edge of that fade wanders, and the world size of its wander.
#pragma param u_blendNoise float default(0.5) range(0,1) ui(slider)
#pragma param u_blendNoiseScale float default(40) range(0.01,100000) ui(slider)
// A second layer: its picture, its colour, how rough it is, and how long one repeat is in the world (0 reads the mesh's own uv).
#pragma param u_layer2 texture default(white)
#pragma param u_layer2Tint color default(1,1,1,1)
#pragma param u_layer2Roughness float default(1) range(0,1) ui(slider)
#pragma param u_layer2Tile float default(0) range(0,100000) ui(slider)
// 1 lets a vertex colour's red paint the second layer, and stops the colour tinting the surface.
#pragma param u_vertexBlend float default(0) range(0,1) ui(slider)
// How far up from what stands behind it the second layer reaches, as a distance field does. 0 keeps it off.
#pragma param u_layerReach float default(0) range(0,100000) ui(slider)
#pragma param u_sceneDepthMap texture default(white) texel(data)
`;

const GLSL_HELPERS = `
float groundNoiseHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Soft noise in the world, about 0..1, so the seam is not a ruled line round the object.
float groundNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(groundNoiseHash(i), groundNoiseHash(i + vec2(1.0, 0.0)), f.x),
               mix(groundNoiseHash(i + vec2(0.0, 1.0)), groundNoiseHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const WGSL_HELPERS = `
fn groundNoiseHash(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn groundNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(groundNoiseHash(i), groundNoiseHash(i + vec2f(1.0, 0.0)), f.x),
               mix(groundNoiseHash(i + vec2f(0.0, 1.0)), groundNoiseHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
`;

const GLSL_SURFACE = `    float groundFade = 1.0;
    float layerWeight = u_vertexBlend > 0.5 ? v_color.r : 0.0;
    vec3 groundBehind = vec3(0.0);
#ifdef MESH_NORMALS
    if (texture(u_sceneDepthMap, vec2(0.5)).a < 0.75 && texture(u_sceneColor, vec2(0.5)).a < 0.75) {
        highp vec3 W = v_worldXYZ;
        vec4 onScreen = u_projection * vec4(W, 1.0);
        vec2 groundUv = clamp(onScreen.xy / max(onScreen.w, 1e-4) * 0.5 + 0.5, vec2(0.001), vec2(0.999));
        highp float own = u_camera.w > 0.5 ? length(W - u_camera.xyz) : -dot(W, u_camera.xyz);
        // r while a 16-bit float holds the distance, b (the same in units of 1024) past that.
        highp vec4 behindAt = texture(u_sceneDepthMap, groundUv);
        highp float along = (behindAt.r < 65000.0 ? behindAt.r : behindAt.b * 1024.0) - own;
        // Height above what is behind, which is the ray's fall: it does not change as the camera tilts. Past a dozen times the
        // band along the ray, what is behind is some other surface beyond, however level with this one it happens to be.
        highp float above = abs(viewDirection(W).y) * max(along, 0.0);
        float reach = max(u_blendDistance, u_layerReach);
        float near = 1.0 - smoothstep(8.0, 12.0, along / max(reach, 1e-3));
        float wander = (groundNoise(W.xz / max(u_blendNoiseScale, 0.01)) - 0.5) * u_blendNoise;
        if (u_blendDistance > 0.0) {
            groundFade = mix(1.0, smoothstep(0.0, 1.0, above / u_blendDistance + wander), near);
            groundBehind = texture(u_sceneColor, groundUv).rgb;
        }
        if (u_layerReach > 0.0) layerWeight = max(layerWeight, near * (1.0 - smoothstep(0.0, 1.0, above / u_layerReach + wander)));
    }
#endif
    vec4 base = texture(u_textures[0], uv) * u_tint;
    if (u_vertexBlend <= 0.5) base *= v_color;
    if (layerWeight > 0.0) {
#ifdef MESH_NORMALS
        vec2 layerUv = u_layer2Tile > 0.0 ? v_worldXYZ.xz / u_layer2Tile : v_texCoord;
#else
        vec2 layerUv = v_texCoord;
#endif
        base = mix(base, texture(u_layer2, layerUv) * u_layer2Tint, layerWeight);
    }
`;

const WGSL_SURFACE = `#ifdef MESH_NORMALS
    // Before any branch: a derivative needs every fragment of its quad.
    let layerWorld = v.v_worldXYZ.xz / max(mc.u_layer2Tile, 1e-4);
    let layerWorldDx = dpdx(layerWorld);
    let layerWorldDy = dpdy(layerWorld);
#endif
    var groundFade = 1.0;
    var layerWeight = 0.0;
    if (mc.u_vertexBlend > 0.5) { layerWeight = v.v_color.r; }
    var groundBehind = vec3f(0.0);
#ifdef MESH_NORMALS
    let groundWanted = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, vec2f(0.5), 0.0).a < 0.75
                    && textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75;
    if (groundWanted) {
        let W = v.v_worldXYZ;
        let onScreen = frame.projection * vec4f(W, 1.0);
        let screenW = max(onScreen.w, 1e-4);
        // This device's rows run down the texture, so clip y is flipped on the way to a uv.
        let groundUv = clamp(vec2f(onScreen.x / screenW * 0.5 + 0.5, 0.5 - onScreen.y / screenW * 0.5), vec2f(0.001), vec2f(0.999));
        var own = -dot(W, frame.camera.xyz);
        if (frame.camera.w > 0.5) { own = length(W - frame.camera.xyz); }
        let behindAt = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, groundUv, 0.0);
        let along = select(behindAt.b * 1024.0, behindAt.r, behindAt.r < 65000.0) - own;
        let above = abs(viewDirection(W).y) * max(along, 0.0);
        let reach = max(mc.u_blendDistance, mc.u_layerReach);
        let near = 1.0 - smoothstep(8.0, 12.0, along / max(reach, 1e-3));
        let wander = (groundNoise(W.xz / max(mc.u_blendNoiseScale, 0.01)) - 0.5) * mc.u_blendNoise;
        if (mc.u_blendDistance > 0.0) {
            groundFade = mix(1.0, smoothstep(0.0, 1.0, above / mc.u_blendDistance + wander), near);
            groundBehind = textureSampleLevel(u_sceneColor, u_sceneColor_s, groundUv, 0.0).rgb;
        }
        if (mc.u_layerReach > 0.0) { layerWeight = max(layerWeight, near * (1.0 - smoothstep(0.0, 1.0, above / mc.u_layerReach + wander))); }
    }
#endif
    var base = textureSampleGrad(t0, s0, uv, duvx, duvy) * mc.u_tint;
    if (mc.u_vertexBlend <= 0.5) { base = base * v.v_color; }
    if (layerWeight > 0.0) {
#ifdef MESH_NORMALS
        var layerUv = v.v_texCoord;
        var layerDx = duvx;
        var layerDy = duvy;
        if (mc.u_layer2Tile > 0.0) {
            layerUv = layerWorld;
            layerDx = layerWorldDx;
            layerDy = layerWorldDy;
        }
        base = mix(base, textureSampleGrad(u_layer2, u_layer2_s, layerUv, layerDx, layerDy) * mc.u_layer2Tint, layerWeight);
#else
        base = mix(base, textureSampleGrad(u_layer2, u_layer2_s, v.v_texCoord, duvx, duvy) * mc.u_layer2Tint, layerWeight);
#endif
    }
`;

function swap(source: string, from: string, to: string): string {
    if (!source.includes(from)) throw new Error(`the Model shader no longer has what Ground Blend is made from: ${from.slice(0, 60)}`);
    return source.replace(from, () => to);
}

/** Ground Blend from the Model shader's source. A refraction reads the same picture, and the two would fight over it, so it is taken out. */
export function deriveGroundBlend(model: string): string {
    let s = swap(model, '#pragma shader "Model"', '#pragma shader "Ground Blend"');
    s = swap(s, '#pragma param u_transmission float default(0) range(0,1) ui(slider)\n', '');
    // With no such param the engine knows this always wants the copy (MaterialStore::usesSceneColor), and the branch below is never taken.
    s = s.replace(/mc\.u_transmission/g, '0.0').replace(/u_transmission/g, '0.0');
    s = swap(s, '#pragma param u_iridescence float', `${PARAMS}#pragma param u_iridescence float`);
    s = swap(s, 'float specularAA(highp vec3', `${GLSL_HELPERS}float specularAA(highp vec3`);
    s = swap(s, 'fn specularAA(dndx : vec3f', `${WGSL_HELPERS}fn specularAA(dndx : vec3f`);
    s = swap(s, '    vec4 base = texture(u_textures[0], uv) * v_color * u_tint;\n', GLSL_SURFACE);
    s = swap(s, '    var base = textureSampleGrad(t0, s0, uv, duvx, duvy) * v.v_color * mc.u_tint;\n', WGSL_SURFACE);
    s = swap(s, 'float roughness = u_roughness * mr.g;', 'float roughness = mix(u_roughness * mr.g, u_layer2Roughness, layerWeight);');
    s = swap(s, 'var roughness = mc.u_roughness * mr.g;', 'var roughness = mix(mc.u_roughness * mr.g, mc.u_layer2Roughness, layerWeight);');
    s = swap(s, 'fragColor = vec4(lit + seen + u_emissive.rgb * texture(u_emissiveMap, uv).rgb, alpha);',
             'fragColor = vec4(mix(groundBehind, lit + seen + u_emissive.rgb * texture(u_emissiveMap, uv).rgb, groundFade), alpha);');
    s = swap(s, 'frag.color = vec4f(lit + seen + emit, alpha);', 'frag.color = vec4f(mix(groundBehind, lit + seen + emit, groundFade), alpha);');
    s = swap(s, 'return vec4f(lit + seen + emit, alpha);', 'return vec4f(mix(groundBehind, lit + seen + emit, groundFade), alpha);');
    return s;
}
