// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  shader-compile-probe.mjs — does this GLSL pair compile and link on THIS machine's real WebGL2 (ANGLE)?
 *
 *   npx electron tools/shader-compile-probe.mjs <vertex.glsl> <fragment.glsl>
 *
 * Prints one JSON line: { ok, vertexLog, fragmentLog, linkLog, contextLost, gpuCrashed }. A shader that kills the
 * GPU process (on Windows, a D3D compiler that recurses past its stack on what ANGLE translated) reports
 * gpuCrashed instead of hanging the caller. A hidden window, like the render host's: nothing is shown.
 * The pair is compiled alone, so a crash names the shader and not the frame that happened to ask for it.
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';

const [vertexPath, fragmentPath] = process.argv.slice(-2);
const vertex = readFileSync(vertexPath, 'utf8');
const fragment = readFileSync(fragmentPath, 'utf8');

let gpuCrashed = false;
app.on('child-process-gone', (_e, details) => { if (details.type === 'GPU') gpuCrashed = true; });

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 64, height: 64 });
    await win.loadURL('data:text/html,<canvas id=c width=8 height=8></canvas>');
    const code = `(async () => {
        const gl = document.getElementById('c').getContext('webgl2');
        if (!gl) return { ok: false, error: 'no webgl2' };
        const make = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const vs = make(gl.VERTEX_SHADER, ${JSON.stringify(vertex)});
        const fs = make(gl.FRAGMENT_SHADER, ${JSON.stringify(fragment)});
        const p = gl.createProgram();
        gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
        const ok = !!gl.getProgramParameter(p, gl.LINK_STATUS);
        return { ok, vertexLog: gl.getShaderInfoLog(vs), fragmentLog: gl.getShaderInfoLog(fs), linkLog: gl.getProgramInfoLog(p),
                 contextLost: gl.isContextLost() };
    })()`;
    let result;
    try {
        result = await Promise.race([
            win.webContents.executeJavaScript(code, true),
            new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 60000)),
        ]);
    } catch (e) {
        result = { ok: false, error: String(e) };
    }
    console.log(JSON.stringify({ ...result, gpuCrashed }));
    app.exit(0);
});
