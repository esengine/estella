// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface EffectStage {
    params: readonly string[];
    glsl: string;
    fn: string;
    neighbours?: boolean;
}

export interface FusedStage {
    effect: string;
    stage: EffectStage;
}

const PIXEL = `precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;`;

const TAP = `vec4 esTap(ivec2 p, ivec2 size) {
    return texelFetch(u_texture, clamp(p, ivec2(0), size - ivec2(1)), 0);
}`;

const NEIGHBOUR_MAIN = (fn: string, after: string): string => `void main() {
    ivec2 size = textureSize(u_texture, 0);
    ivec2 p = clamp(ivec2(v_texCoord * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 c = ${fn}(p, size);
${after}    fragColor = c;
}`;

function shaderSource(name: string, params: readonly string[], body: string): string {
    return `#pragma shader "${name}"
#pragma version 300 es
#pragma domain PostProcess
${params.join('\n')}

#pragma fragment
${PIXEL}

${body}
#pragma end

`;
}

export function stageShaderSource(name: string, stage: EffectStage): string {
    if (stage.neighbours) return shaderSource(name, stage.params, `${TAP}\n\n${stage.glsl}\n\n${NEIGHBOUR_MAIN(stage.fn, '')}`);
    return shaderSource(name, stage.params, `${stage.glsl}

void main() {
    fragColor = ${stage.fn}(texture(u_texture, v_texCoord), v_texCoord);
}`);
}

const PARAM = /^#pragma\s+param\s+(\w+)/;

export function fusedParamName(effect: string, param: string): string {
    return `u_${effect}_${param.startsWith('u_') ? param.slice(2) : param}`;
}

function renamed({ effect, stage }: FusedStage): { params: string[]; glsl: string } {
    let params = [...stage.params];
    let glsl = stage.glsl;
    for (const line of stage.params) {
        const name = PARAM.exec(line)?.[1];
        if (!name) continue;
        const word = new RegExp(`\\b${name}\\b`, 'g');
        const to = fusedParamName(effect, name);
        params = params.map((p) => p.replace(word, to));
        glsl = glsl.replace(word, to);
    }
    return { params, glsl };
}

export function fusedShaderSource(stages: readonly FusedStage[]): string {
    const k = stages.findIndex((s) => s.stage.neighbours);
    const parts = stages.map(renamed);
    const apply = (from: number, to: number, uv: string): string =>
        stages.slice(from, to).map((s) => `    c = ${s.stage.fn}(c, ${uv});\n`).join('');
    const body: string[] = [];
    for (const [i, part] of parts.entries()) {
        if (i === k) {
            body.push(k === 0 ? TAP : `vec4 esTap(ivec2 p, ivec2 size) {
    ivec2 q = clamp(p, ivec2(0), size - ivec2(1));
    vec4 c = texelFetch(u_texture, q, 0);
    vec2 uv = (vec2(q) + 0.5) / vec2(size);
${apply(0, k, 'uv')}    return c;
}`);
        }
        body.push(part.glsl);
    }
    body.push(k < 0 ? `void main() {
    vec4 c = texture(u_texture, v_texCoord);
${apply(0, stages.length, 'v_texCoord')}    fragColor = c;
}` : NEIGHBOUR_MAIN(stages[k]!.stage.fn, apply(k + 1, stages.length, 'v_texCoord')));
    const name = `PP ${stages.map((s) => s.effect).join(' + ')}`;
    return shaderSource(name, parts.flatMap((p) => p.params), body.join('\n\n'));
}
