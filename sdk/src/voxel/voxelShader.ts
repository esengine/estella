// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  voxelShader.ts
 * @brief The Model shader, for ground with no uv: up to four materials weighted by the vertex colour, each read from the three sides.
 *
 * @details A volume's skin is found afterwards and can face any way, so nothing could be unwrapped: each picture is laid by world position along
 *          whichever axis the surface faces. The vertex colour is how much of each material a vertex is. Being derived from Model it is lit,
 *          shadowed and fogged as anything else in the scene is, and a material moved onto it keeps every param it had.
 */
import { modelWithoutDetail, modelLine } from '../render/modelDetail';

/** Material 0 is the shader's main texture, so the others cost three more. The emissive map gives its unit up: this skin has no uv to read one by. */
const PARAMS = `// The colour of each material, multiplied into its picture.
#pragma param u_voxelTint0 color default(0.3,0.42,0.2,1)
#pragma param u_voxelTint1 color default(0.36,0.27,0.18,1)
#pragma param u_voxelTint2 color default(0.42,0.41,0.4,1)
#pragma param u_voxelTint3 color default(0.72,0.55,0.25,1)
// The pictures of materials 1 to 3. Material 0's is the main texture.
#pragma param u_voxelMap1 texture default(white)
#pragma param u_voxelMap2 texture default(white)
#pragma param u_voxelMap3 texture default(white)
// How long one repeat of the pictures is in the world.
#pragma param u_voxelTile float default(8) range(0.01,100000) ui(slider)
// How rough each material is.
#pragma param u_voxelRoughness vec4 default(0.95,0.95,0.85,0.45)
`;

const GLSL_HELPERS = `
vec4 voxelRead(sampler2D map, highp vec3 W, vec3 side) {
    return texture(map, W.zy) * side.x + texture(map, W.xz) * side.y + texture(map, W.xy) * side.z;
}
`;


const GLSL_SURFACE = `#ifdef MESH_NORMALS
    highp vec3 voxelW = v_worldXYZ / u_voxelTile;
    vec3 voxelSide = pow(abs(normalize(v_worldNormal)), vec3(4.0));
    voxelSide /= max(voxelSide.x + voxelSide.y + voxelSide.z, 1e-4);
    vec4 voxelMix = v_color / max(v_color.r + v_color.g + v_color.b + v_color.a, 1e-4);
    vec4 base = voxelRead(u_textures[0], voxelW, voxelSide) * u_voxelTint0 * voxelMix.r
              + voxelRead(u_voxelMap1, voxelW, voxelSide) * u_voxelTint1 * voxelMix.g
              + voxelRead(u_voxelMap2, voxelW, voxelSide) * u_voxelTint2 * voxelMix.b
              + voxelRead(u_voxelMap3, voxelW, voxelSide) * u_voxelTint3 * voxelMix.a;
    base.a = 1.0;
    base.rgb *= u_tint.rgb;
#else
    vec4 voxelMix = vec4(0.0, 0.0, 1.0, 0.0);
    vec4 base = u_voxelTint2 * u_tint;
#endif
`;


function swap(source: string, from: string | RegExp, to: string): string {
    if (typeof from === 'string' ? !source.includes(from) : !from.test(source)) {
        throw new Error(`the Model shader no longer has what Voxel Ground is made from: ${String(from).slice(0, 60)}`);
    }
    return source.replace(from, () => to);
}

/** Voxel Ground from the Model shader's source. */
export function deriveVoxelGround(model: string): string {
    let s = swap(modelWithoutDetail(model), '#pragma shader "Model"', '#pragma shader "Voxel Ground"');
    s = swap(s, '#pragma param u_iridescence float', `${PARAMS}#pragma param u_iridescence float`);
    s = swap(s, '#pragma param u_emissiveMap texture default(white) group(Emissive)\n', '');
    s = swap(s, 'texture(u_emissiveMap, uv).rgb', 'vec3(1.0)');
    s = swap(s, 'float specularAA(highp vec3', `${GLSL_HELPERS}float specularAA(highp vec3`);
    s = swap(s, modelLine('vec4 base = texture(u_textures[0], uv) * v_color * u_tint;'), GLSL_SURFACE);
    s = swap(s, 'float roughness = u_roughness * mr.g;', 'float roughness = u_roughness * mr.g * dot(voxelMix, u_voxelRoughness);');
    return s;
}
