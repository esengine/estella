// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gltrace.js — what the page asked WebGL for, in order, for a GPU process that dies mid-frame.
 *
 * Loaded before the engine and inert unless the page is opened with `gltrace=1` (run.mjs does that for
 * ESTELLA_VERIFY_GL_TRACE). Every shader compiled, program linked (with its sources, once), program used and
 * draw made is printed as a `GLTRACE ` console line, which the runner appends to a file as it arrives: when the
 * GPU process dies inside a driver or a shader compiler, the last line is the call it died in.
 */
(() => {
    if (!new URLSearchParams(location.search).has('gltrace')) return;
    const P = WebGL2RenderingContext.prototype;
    const ids = new WeakMap();
    let next = 1;
    const id = (o) => {
        if (!o) return 0;
        if (!ids.has(o)) ids.set(o, next++);
        return ids.get(o);
    };
    const sources = new WeakMap();
    const printed = new WeakSet();
    const log = (s) => console.log('GLTRACE ' + s);
    const wrap = (name, before) => {
        const orig = P[name];
        P[name] = function (...args) {
            before.apply(this, args);
            return orig.apply(this, args);
        };
    };
    wrap('shaderSource', function (shader, text) { sources.set(shader, text); });
    wrap('compileShader', function (shader) { log('compile shader#' + id(shader)); });
    wrap('attachShader', function (program, shader) { log('attach program#' + id(program) + ' shader#' + id(shader)); });
    wrap('linkProgram', function (program) {
        log('link program#' + id(program));
        for (const shader of this.getAttachedShaders(program) || []) {
            if (printed.has(shader)) continue;
            printed.add(shader);
            log('source shader#' + id(shader) + ' ' + JSON.stringify(sources.get(shader) || ''));
        }
    });
    wrap('useProgram', function (program) { log('use program#' + id(program)); });
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        wrap(d, function (...a) { log(d + ' ' + a.slice(0, 3).join(',')); });
    }
})();
