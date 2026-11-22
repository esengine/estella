// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run the production projector on a flat surface and a diverging bundle in headless WebGL 2.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../../sdk/src/water/causticProjection.ts', import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm' });
const { CAUSTIC_PROJECTION } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate((source) => {
    const n = 64, depth = 64, stretch = 2, layer = 4;
    const canvas = document.createElement('canvas');
    canvas.width = 3 * n;
    canvas.height = n;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true });
    if (!gl) throw new Error('WebGL 2 is required');
    const program = gl.createProgram();
    for (const [stage, type] of [['vertex', gl.VERTEX_SHADER], ['fragment', gl.FRAGMENT_SHADER]]) {
      const body = source.split(`#pragma ${stage}\n`)[1].split('#pragma end')[0];
      const header = 'precision highp float;\nuniform sampler2D u_surface, u_bakeReceiverDepth, u_bakeMovingDepth, u_zoneSurfaceData;\nuniform float u_causticStrength, u_density;\nuniform vec4 u_absorption, u_causticBodyRect, u_causticBodyOcean;\nuniform vec4 u_window, u_levels, u_bakeSun, u_bakeReceiverWindow;\n';
      const shader = gl.createShader(type);
      gl.shaderSource(shader, '#version 300 es\n' + header + body);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform4f(gl.getUniformLocation(program, 'u_window'), 0, 0, n, n);
    gl.uniform4f(gl.getUniformLocation(program, 'u_levels'), 0, 1, 0, depth / layer);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DITHER);

    gl.uniform4f(gl.getUniformLocation(program, 'u_bakeReceiverWindow'), 0, 0, 1, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_bakeReceiverDepth'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_bakeMovingDepth'), 2);
    for (const unit of [gl.TEXTURE1, gl.TEXTURE2]) {
        gl.activeTexture(unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function depthMap(unit, shelf, empty, centreOnly) {
      gl.activeTexture(unit);
      const receivers = new Uint8Array(n * n * 4);
      const reach = 15 * depth / layer, head = 1 + 0.01 * reach;
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        const first = shelf && Math.abs(x - n / 2) < 10 ? depth / 2 : depth;
        let value = 0.5 + 0.5 * (first + head) / (reach + head);
        const at = 4 * (z * n + x);
        for (let j = 0; j < 3; j++) {
          value *= 255;
          receivers[at + j] = Math.floor(value);
          value -= Math.floor(value);
        }
        receivers[at + 3] = empty || (centreOnly && Math.abs(x - n / 2) >= 10) ? 0 : 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, receivers);
    }

    function project(magnification, sun, shelf = false, empty = false, moving = false) {
      depthMap(gl.TEXTURE1, shelf && !moving, empty, false);
      depthMap(gl.TEXTURE2, true, !moving, true);
      gl.uniform4f(gl.getUniformLocation(program, 'u_bakeReceiverWindow'), 0, 0, 1, moving ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      const data = new Uint8Array(n * n * 4);
      for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
        // Invert Snell's law so neighbouring rays land exactly magnification texels apart.
        // Centre the synthetic lens on a texel. A lens centred between two texels can
        // accidentally distribute a fixed one-texel tent evenly at this exact magnification.
        const slope = -(x - n / 2) * (magnification - 1) / depth;
        const rayY = 1 / Math.hypot(1, slope), rayX = slope * rayY;
        const nx = rayX / Math.hypot(rayX, rayY - 1 / 1.333);
        const i = 4 * (z * n + x);
        data[i] = Math.round(128 + 127 * nx);
        data[i + 1] = 128;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.uniform4f(gl.getUniformLocation(program, 'u_bakeSun'), 0, 1, 0, sun);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 2 * n * n + 1);
      const sample = new Uint8Array(16 * 4);
      gl.readPixels(n / 2 - 8, n / 2, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
      return Array.from(sample).filter((_, i) => i % 4 === 0).map(value => value / 32);
    }
    return { flat: project(1, 1), dark: project(1, 0), spread: project(stretch, 1), shelf: project(stretch, 1, true), empty: project(1, 1, false, true), moving: project(stretch, 1, true, false, true) };
  }, CAUSTIC_PROJECTION);
  assert.ok(result.flat.every(v => Math.abs(v - 1) < 0.04), 'a level surface preserves unit irradiance');
  assert.ok(result.dark.every(v => v === 0), 'a disabled sun carries no flux');
  // A twofold spread has half the irradiance. Both the average and the local envelope matter.
  const mean = result.spread.reduce((a, b) => a + b) / result.spread.length;
  assert.ok(Math.abs(mean - 0.5) < 0.06, `spread loses energy: ${mean}`);
  assert.ok(result.spread.every(v => Math.abs(v - 0.5) < 0.13), `spurious holes in the footprint: ${result.spread}`);
  assert.ok(result.empty.every(v => v === 0), 'rays without a solid hit write no surface caustic');
  const shelfMean = result.shelf.slice(3, -3).reduce((a, b) => a + b) / (result.shelf.length - 6);
  assert.ok(Math.abs(shelfMean - 2/3) < 0.09 && shelfMean > mean + 0.10,
    `the raised receiver must take the beam at its own depth: ${shelfMean}, bed ${mean}`);
  assert.deepEqual(result.moving, result.shelf, 'static and moving receivers stop the same ray at the same depth');
  // Exercise the receiver function that the native 3D material compiler injects. The old
  // projector-only test passed even when the scene compositor discarded all negative changes.
  const header = await readFile(new URL('../../src/esengine/resource/WaterSunShader.hpp', import.meta.url), 'utf8');
  const receiver = header.match(/WATER_SUN_GLSL\[\] = R"\(([\s\S]*?)\)";/)[1];
  const values = await page.evaluate((body) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false });
    const program = gl.createProgram();
    const vertex = 'void main(){gl_Position=vec4(float((gl_VertexID<<1)&2)*2.-1.,float(gl_VertexID&2)*2.-1.,0.,1.);}';
    const fragment = `precision highp float;
#define ES_SURFACE_3D
struct Light { vec4 posDir; vec4 color; };
uniform vec4 u_waterRect, u_waterDepth, u_waterSun;
uniform float receiverY;
out vec4 colour;
${body}
void main() {
    Light sun = Light(vec4(0,-1,1,0), vec4(1));
    waterIncidentSun(sun,vec3(0,receiverY,0));
    colour = vec4(sun.color.rgb * 0.25,1);
}`;
    for (const [stage, text] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(stage);
      gl.shaderSource(shader, '#version 300 es\n' + text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform4f(gl.getUniformLocation(program, 'u_waterRect'), -4, -4, 8, 0.2);
    gl.uniform4f(gl.getUniformLocation(program, 'u_waterDepth'), 0, 0, 64, 4);
    const shade = (flux, gain, y = -32) => {
      // Packed depth .75 lands at 32. Alpha 128 is exactly gain zero even on UNORM8.
      const texels = new Uint8Array([32*flux,16*flux,16*flux,32*flux,191,63,191,Math.round(128+31.75*gain),0,0,0,0]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,3,1,0,gl.RGBA,gl.UNSIGNED_BYTE,texels);
      gl.uniform1f(gl.getUniformLocation(program, 'receiverY'), y);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixel = new Uint8Array(4);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      return pixel[0];
    };
    return {flat:shade(1,1), dim:shade(.5,1), bright:shade(2,1), empty:shade(0,1),
      off:shade(0,0), above:shade(2,1,2), hidden:shade(2,1,-36), highGain:shade(.5,4)};
  }, receiver);
  assert.ok(Math.abs(values.flat-64)<=1 && Math.abs(values.dim-32)<=1 && Math.abs(values.bright-128)<=2);
  assert.equal(values.empty,0);
  assert.equal(values.off,values.flat);
  assert.equal(values.above,values.flat);
  assert.equal(values.hidden,0);
  assert.ok(values.highGain>0 && values.highGain<values.dim);
  console.log('Water caustic flux and first hits verified on the bed and a raised receiver.');
} finally {
  await browser.close();
}
