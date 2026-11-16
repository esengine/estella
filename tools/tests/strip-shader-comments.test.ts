// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { applyStrip, shaderStripEdits } from '../../sdk/scripts/strip-shader-comments.mjs';

const strip = (code: string) => applyStrip(code, shaderStripEdits(code), 'm.ts').code;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Every generated (line, column) segment of a v3 map, with the source (line, column) it names. */
function decode(mappings: string): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    let srcLine = 0, srcCol = 0;
    mappings.split(';').forEach((line, genLine) => {
        let genCol = 0;
        for (const seg of line.split(',').filter(Boolean)) {
            const v: number[] = [];
            let shift = 0, value = 0;
            for (const ch of seg) {
                const d = B64.indexOf(ch);
                value += (d & 31) << shift;
                if (d & 32) shift += 5;
                else { v.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
            }
            genCol += v[0]; srcLine += v[2]; srcCol += v[3];
            out.push([genLine, genCol, srcLine, srcCol]);
        }
    });
    return out;
}

describe('strip-shader-comments', () => {
    it('takes comments and indentation out of a shader and keeps every line', () => {
        const code = 'const S = `#pragma shader "X"\n// a note\nvoid main() {\n    float a = 1.0; // why\n    fragColor = vec4(a);   \n}\n`;\n';
        const out = strip(code);
        expect(out).toBe('const S = `#pragma shader "X"\n\nvoid main() {\nfloat a = 1.0;\nfragColor = vec4(a);\n}\n`;\n');
        expect(out.split('\n').length).toBe(code.split('\n').length);
    });

    it('keeps the marker comments code cuts a shader by', () => {
        const code = 'const S = `void main() {\n    // <detail>\n    x = vec3(1.0); // <detail/>\n    // </detail>\n}`;\n';
        expect(strip(code)).toBe('const S = `void main() {\n// <detail>\nx = vec3(1.0); // <detail/>\n// </detail>\n}`;\n');
    });

    it('leaves a line that runs into a spliced value as it is', () => {
        const code = 'const S = `void main() {\n    float k = ${K}; // after\n    // note ${X}\n    return ${A} + b; // c\n}`;\n';
        // The first line's tail after `${K}` starts a new piece (no indentation to take); the comment line runs into `${X}`.
        expect(strip(code)).toBe('const S = `void main() {\nfloat k = ${K};\n// note ${X}\nreturn ${A} + b;\n}`;\n');
    });

    it('touches no template that is not a shader, or not on several lines', () => {
        for (const code of ['const S = `hello\n    world // not a shader\n`;\n', 'const S = `vec3(1.0) // one line`;\n']) {
            expect(strip(code)).toBe(code);
        }
    });

    it('leaves a template with a line continuation, and a URL', () => {
        const cont = 'const S = `void main() {\n    // a \\\n    x = vec2(0.0);\n}`;\n';
        expect(strip(cont)).toBe(cont);
        expect(strip('const S = `void main() {\n    #include "http://x/y"\n}`;\n')).toBe('const S = `void main() {\n#include "http://x/y"\n}`;\n');
    });

    it('keeps the CR of a CRLF source', () => {
        expect(strip('const S = `void main() {\r\n    x = 1.0; // c\r\n}`;\r\n')).toBe('const S = `void main() {\r\nx = 1.0;\r\n}`;\r\n');
    });

    it('maps every kept character back to where it was', () => {
        const code = 'import x from "y";\nconst S = `#pragma shader "X"\n// a note\nvoid main() {\n    float a = 1.0; // why\n    fragColor = vec4(a);\n}\n`;\nexport const T = S + x;\n';
        const { code: out, map } = applyStrip(code, shaderStripEdits(code), 'm.ts');
        const segs = decode(map.mappings);
        const srcLines = code.split('\n'), outLines = out.split('\n');
        outLines.forEach((line, gl) => {
            for (let gc = 0; gc < line.length; gc++) {
                // The last segment at or before this column covers it.
                const s = segs.filter(([l, c]) => l === gl && c <= gc).pop()!;
                expect(srcLines[s[2]][s[3] + gc - s[1]], `line ${gl} col ${gc}`).toBe(line[gc]);
            }
        });
    });
});
