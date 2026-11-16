// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    strip-shader-comments.mjs
 * @brief   A bundler plugin that takes the `//` comments and the indentation out of the shader text the SDK's modules carry.
 *
 * The built-in shaders are GLSL and WGSL in template literals, written to be read, and the bundle carried them as written:
 * about a fifth of `index.bundled.js` was shader text, a sixth of that comments. The minifier cannot touch the inside of a
 * string, so this does, before it, in the module source.
 *
 * Every line break is kept, so a compile error still names the line it names in the source. Only a template that reads as a
 * shader (a pragma, an entry point, a vector constructor, a uniform) and spans lines is touched, and in it only:
 *   - a `//` comment that ends inside the same piece of literal text. One that runs into a `${...}` is left whole, since
 *     the value spliced there is on the comment's line. A marker comment (`// <name>`, `// </name>`, `// <name/>`) is kept:
 *     code cuts shaders by them (see render/modelDetail.ts).
 *   - spaces and tabs at the start of a line, and at the end of one.
 * A template with a backslash at the end of a line (a line continuation, which would carry a comment onto the next line)
 * is left as it is.
 */
import ts from 'typescript';

const SHADER = /#pragma |\bvoid main\s*\(|@(?:fragment|vertex|compute)\b|\bvec[234]f?\s*\(|\buniform\s|\bprecision (?:high|medium|low)p\b|\bfn \w+\s*\(/;
// A `//` that opens a comment: not the one in a URL's scheme.
const COMMENT = /(^|[^:/])\/\/[^\n]*/g;
// A comment that is a marker code finds the shader by (modelDetail's `// <detail>`, `// </detail>`, `// <detail/>`): kept.
const MARKER = /^\/\/\s*<\/?[\w-]+\/?>\s*$/;

/**
 * The edits that strip one piece of a template's raw text, as [start, end) ranges relative to the piece. `endsOpen` is
 * true for a piece a `${` ends, whose last line runs on into the value spliced there.
 */
function pieceEdits(raw, endsOpen) {
    const edits = [];
    let lineStart = 0;
    let atLineStart = false; // the piece's first line continues whatever came before it
    for (;;) {
        const nl = raw.indexOf('\n', lineStart);
        const last = nl === -1;
        const lineEnd = last ? raw.length : nl;
        // A CRLF source keeps its CR: the template's value has none either way (a literal's line breaks read as LF).
        const len = lineEnd - lineStart - (!last && raw[lineEnd - 1] === '\r' ? 1 : 0);
        const line = raw.slice(lineStart, lineStart + len);
        // Leading indentation, where the piece's text is at the start of a line.
        let a = 0;
        if (atLineStart) {
            while (a < len && (line[a] === ' ' || line[a] === '\t')) a++;
            if (a > 0) edits.push([lineStart, lineStart + a]);
        }
        // A line that runs into a `${` keeps its end: no comment is cut there, and the space before the value stays.
        if (!(last && endsOpen)) {
            let end = len;
            COMMENT.lastIndex = 0;
            const m = COMMENT.exec(line);
            if (m && !MARKER.test(m[0].slice(m[1].length))) end = m.index + m[1].length;
            while (end > a && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
            if (end < len) edits.push([lineStart + Math.max(a, end), lineStart + len]);
        }
        if (last) break;
        lineStart = nl + 1;
        atLineStart = true;
    }
    return edits;
}

/** The [start, end) ranges of `code` to delete, for every shader template in it. */
export function shaderStripEdits(code, fileName = 'module.ts') {
    if (!code.includes('`') || !SHADER.test(code)) return [];
    const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const out = [];
    const visit = (node) => {
        if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
            // Each piece of literal text: its raw source range (inside the backticks / `}` and `${`), and whether a `${` ends it.
            const pieces = [];
            const piece = (lit, open) => {
                const start = lit.getStart(sf) + 1;
                const end = lit.end - (open ? 2 : 1);
                pieces.push({ start, end, open });
            };
            if (ts.isNoSubstitutionTemplateLiteral(node)) piece(node, false);
            else {
                piece(node.head, true);
                for (const span of node.templateSpans) piece(span.literal, ts.isTemplateMiddle(span.literal));
            }
            const text = pieces.map((p) => code.slice(p.start, p.end)).join('');
            if (text.includes('\n') && SHADER.test(text) && !/\\\r?\n/.test(text)) {
                for (const p of pieces) {
                    for (const [a, b] of pieceEdits(code.slice(p.start, p.end), p.open)) out.push([p.start + a, p.start + b]);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(n) {
    let v = n < 0 ? (-n << 1) | 1 : n << 1;
    let s = '';
    do {
        let digit = v & 31;
        v >>>= 5;
        if (v > 0) digit |= 32;
        s += B64[digit];
    } while (v > 0);
    return s;
}

/**
 * Applies the edits, and a source map from the result back to `code`: a segment at the start of each line and after each
 * deletion, so every kept character maps to where it was. Deletions never cross a line break.
 */
export function applyStrip(code, edits, fileName) {
    edits.sort((x, y) => x[0] - y[0]);
    let result = '';
    let mappings = '';
    let prevSrcLine = 0, prevSrcCol = 0;
    let srcLine = 0, srcLineStart = 0;
    let outCol = 0, prevOutCol = 0;
    let lineSegs = [];
    const seg = (srcPos) => {
        const col = srcPos - srcLineStart;
        lineSegs.push(vlq(outCol - prevOutCol) + 'A' + vlq(srcLine - prevSrcLine) + vlq(col - prevSrcCol));
        prevOutCol = outCol; prevSrcLine = srcLine; prevSrcCol = col;
    };
    let pos = 0, e = 0;
    seg(0);
    while (pos < code.length) {
        if (e < edits.length && edits[e][0] === pos) {
            pos = edits[e][1];
            e++;
            if (pos < code.length && code[pos] !== '\n') seg(pos);
            continue;
        }
        const nextEdit = e < edits.length ? edits[e][0] : code.length;
        const nl = code.indexOf('\n', pos);
        const stop = Math.min(nextEdit, nl === -1 ? code.length : nl);
        result += code.slice(pos, stop);
        outCol += stop - pos;
        pos = stop;
        if (pos === nl) {
            result += '\n';
            pos++;
            mappings += lineSegs.join(',') + ';';
            lineSegs = [];
            outCol = 0; prevOutCol = 0;
            srcLine++; srcLineStart = pos;
            if (pos < code.length) seg(pos);
        }
    }
    mappings += lineSegs.join(',');
    return { code: result, map: { version: 3, file: fileName, sources: [fileName], sourcesContent: [code], names: [], mappings } };
}

/** The plugin: strips the shader text of the SDK's own TypeScript modules. */
export function stripShaderComments() {
    return {
        name: 'strip-shader-comments',
        transform(code, id) {
            if (!/[\\/]sdk[\\/]src[\\/].*\.ts$/.test(id) || id.endsWith('.d.ts')) return null;
            const edits = shaderStripEdits(code, id);
            if (edits.length === 0) return null;
            return applyStrip(code, edits, id);
        },
    };
}
