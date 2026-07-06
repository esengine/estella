// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    builtinShaders.ts
 * @brief   Built-in .esshader templates — the engine's stock material starting points.
 */

export interface BuiltinShaderTemplate {
    id: string;
    /** Menu / picker label, e.g. "Lit". */
    label: string;
    description: string;
    source: string;
    /** Initial .esmaterial `properties` for a material born from this template. */
    defaults: Record<string, unknown>;
}

const SPRITE_UNLIT = `#pragma shader "Sprite Unlit"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_tint color default(1,1,1,1)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color * u_tint;
}
#pragma end
`;

const SPRITE_LIT = `#pragma shader "Sprite Lit"
#pragma version 300 es
#pragma domain Lit2D
#pragma param u_tint color default(1,1,1,1)
#pragma param u_normalMap texture default(flatnormal)

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;

uniform sampler2D u_textures[8];

out vec4 fragColor;

// Unset u_normalMap = flat normal, so lighting works with no normal map assigned.
void main() {
    vec4 base = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec3 N = es_sampleNormal(u_normalMap, v_texCoord);
    fragColor = vec4(es_applyLighting2D(base.rgb, N, v_worldPos), base.a);
}
#pragma end
`;

export const BUILTIN_SHADER_TEMPLATES: readonly BuiltinShaderTemplate[] = [
    {
        id: 'sprite-unlit',
        label: 'Unlit',
        description: 'Texture × vertex color × tint, no lighting.',
        source: SPRITE_UNLIT,
        defaults: { u_tint: { r: 1, g: 1, b: 1, a: 1 } },
    },
    {
        id: 'sprite-lit',
        label: 'Lit',
        description: 'Lit by the scene\'s 2D lights; optional normal map.',
        source: SPRITE_LIT,
        defaults: { u_tint: { r: 1, g: 1, b: 1, a: 1 } },
    },
];

export function builtinShaderTemplate(id: string): BuiltinShaderTemplate | undefined {
    return BUILTIN_SHADER_TEMPLATES.find((t) => t.id === id);
}
