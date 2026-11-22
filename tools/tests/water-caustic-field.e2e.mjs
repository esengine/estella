// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Run the production projector on a flat surface and a diverging bundle in headless WebGL 2.
import assert from 'node:assert/strict';
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
    canvas.width = canvas.height = 4 * n;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL 2 is required');
    const program = gl.createProgram();
    for (const [stage, type] of [['vertex', gl.VERTEX_SHADER], ['fragment', gl.FRAGMENT_SHADER]]) {
      const body = source.split(`#pragma ${stage}\n`)[1].split('#pragma end')[0];
      const header = 'precision highp float;\nuniform sampler2D u_surface;\nuniform vec4 u_window, u_levels, u_bakeSun;\n';
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
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
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

    function project(magnification, sun) {
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
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n * n * 16);
      const sample = new Uint8Array(16 * 4);
      gl.readPixels(n / 2 - 8, n + n / 2, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
      return Array.from(sample).filter((_, i) => i % 4 === 0).map(value => value / 32);
    }
    return { flat: project(1, 1), dark: project(1, 0), spread: project(stretch, 1) };
  }, CAUSTIC_PROJECTION);
  assert.ok(result.flat.every(v => Math.abs(v - 1) < 0.04), 'a level surface preserves unit irradiance');
  assert.ok(result.dark.every(v => v === 0), 'a disabled sun carries no flux');
  // A twofold spread has half the irradiance. Both the average and the local envelope matter.
  const mean = result.spread.reduce((a, b) => a + b) / result.spread.length;
  assert.ok(Math.abs(mean - 0.5) < 0.06, `spread loses energy: ${mean}`);
  assert.ok(result.spread.every(v => Math.abs(v - 0.5) < 0.13), `spurious holes in the footprint: ${result.spread}`);
  console.log('Water caustic flux preserved for flat, dark and diverging beams.');
} finally {
  await browser.close();
}
