// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPlayable } from '../verify-playable.mjs';

const active = { type: 'click', x: 0.5, y: 0.5, expect: { event: 'store-click', count: 1, userActivation: true }, observeMs: 100 };
const scenario = { version: 1, viewports: [{ width: 200, height: 200 }], steps: [active,
  { type: 'host', command: 'hide' }, { type: 'frozen', ms: 200 },
  { type: 'click', x: 0.5, y: 0.5, expect: { event: 'store-click', count: 0 }, observeMs: 100 },
  { type: 'host', command: 'show' }, active] };

/** A real WebGL page for the verifier, not an engine/render acceptance fixture. */
function creative({ fetchExternal = false, fetchLocalSdk = false, hiddenClick = false, hiddenAnimation = false, overflow = false } = {}) {
  return `<!doctype html><html><head><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style></head><body><canvas width="200" height="200"></canvas><script>
  window.__estellaIdentDone=true;
  mraid.addEventListener('ready',()=>{});
  const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl');
  const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);return s};
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform float phase;void main(){gl_FragColor=vec4(phase,.4,.8,1.);}'));gl.linkProgram(program);gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);let phase=0;
  function draw(){if(mraid.isViewable()||${hiddenAnimation}){phase=(phase+.07)%1;gl.uniform1f(gl.getUniformLocation(program,'phase'),phase);gl.drawArrays(gl.TRIANGLES,0,3)}requestAnimationFrame(draw)}draw();
  canvas.addEventListener('pointerup',()=>{if(mraid.isViewable()||${hiddenClick})mraid.open('https://example.com/store')});
  ${fetchExternal ? "fetch('https://example.invalid/forbidden').catch(()=>{})" : ''}
  ${fetchLocalSdk ? "fetch('/host-sdk.js',{method:'POST'}).catch(()=>{})" : ''}
  ${overflow ? "for(let i=0;i<4100;i++)window.postMessage({source:'estella-playable-preview',type:'event',name:'noise',data:{}},location.origin)" : ''}
  </script></body></html>`;
}

async function fixture(options, run, plan = scenario, staticFailure = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'estella-playable-runner-'));
  const htmlFile = path.join(root, 'index.html'), scenarioFile = path.join(root, 'scenario.json'), reportFile = path.join(root, 'export.json'), outDir = path.join(root, 'results');
  const html = creative(options), hash = createHash('sha256').update(html).digest('hex');
  await writeFile(htmlFile, html); await writeFile(scenarioFile, JSON.stringify(plan));
  await writeFile(reportFile, JSON.stringify({ ok: !options?.exportFailure, errors: options?.exportFailure ? ['Synthetic failed asset cook'] : [], playableCheck: { network: 'mraid', htmlSha256: hash, deliverySha256: hash,
    checks: staticFailure ? [{ id: 'delivery-size', status: 'fail', detail: 'Synthetic failed static check' }] : [] } }));
  try {
    const result = await verifyPlayable({ htmlFile, scenarioFile, reportFile, outDir, timeoutMs: 1000,
      onProgress: options?.tamper ? () => { writeFileSync(htmlFile, html + '\n<!-- changed -->'); } : undefined });
    await run(result, JSON.parse(await readFile(path.join(outDir, 'runtime-check.json'), 'utf8')));
  } finally {
    const target = path.resolve(root), temp = path.resolve(tmpdir());
    if (!target.startsWith(temp + path.sep) || !path.basename(target).startsWith('estella-playable-runner-')) throw new Error('Unexpected runner fixture cleanup');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('headless runner records trusted clicks, hidden freeze/input, hashes and pending acceptance', async () => {
  await fixture({}, async (result, saved) => {
    assert.equal(result.status, 'checks-passed'); assert.equal(saved.mode, 'local-mock'); assert.equal(saved.headless, true);
    assert.equal(saved.identityScope, 'delivery'); assert.match(saved.verifierSha256, /^[a-f0-9]{64}$/); assert.match(saved.scenarioSha256, /^[a-f0-9]{64}$/);
    assert.ok(saved.pending.some(note => note.includes('Original host SDK')));
    assert.ok(saved.cases[0].steps.filter(step => step.type === 'click').every(step => step.trustedPointer));
    assert.ok(saved.cases[0].drawCalls > 0); assert.equal(saved.cases[0].truncatedEvents, 0);
    assert.ok(saved.cases[0].requests.every(request => request.expected));
    assert.equal(saved.cases[0].steps.find(step => step.type === 'frozen').beforeSha256, saved.cases[0].steps.find(step => step.type === 'frozen').afterSha256);
  });
});
test('blocked external fetch is a failure even when the game handles the rejection', async () => {
  await fixture({ fetchExternal: true }, async result => {
    assert.equal(result.status, 'failed'); assert.ok(result.cases[0].events.some(event => event.name === 'blocked-request'));
  });
});
test('fetching an allowed SDK path as a POST is still an unexpected request', async () => {
  await fixture({ fetchLocalSdk: true }, async result => {
    assert.equal(result.status, 'failed'); assert.ok(result.cases[0].requests.some(request => request.method === 'POST' && !request.expected));
  });
});
test('missing CTA calls fail the actual step and retain the observed count', async () => {
  await fixture({}, async result => {
    assert.equal(result.status, 'failed'); assert.equal(result.cases[0].steps[0].status, 'failed');
    assert.equal(result.cases[0].steps[0].observedCount, 1);
  }, { ...scenario, steps: [{ ...active, expect: { event: 'store-click', count: 2 } }] });
});
test('hidden CTA accepting input fails', async () => {
  await fixture({ hiddenClick: true }, async result => {
    assert.equal(result.status, 'failed'); assert.equal(result.cases[0].steps[3].status, 'failed');
    assert.equal(result.cases[0].steps[3].observedCount, 1);
  });
});
test('hidden animation continuing fails the screenshot comparison', async () => {
  await fixture({ hiddenAnimation: true }, async result => {
    assert.equal(result.status, 'failed'); assert.equal(result.cases[0].steps[2].status, 'failed');
  });
});
test('event truncation cannot be reported as complete evidence', async () => {
  await fixture({ overflow: true }, async result => {
    assert.equal(result.status, 'failed'); assert.ok(result.cases[0].truncatedEvents > 0);
  });
});
test('input file mutation during verification invalidates the result', async () => {
  await fixture({ tamper: true }, async result => {
    assert.equal(result.status, 'failed'); assert.ok(result.errors.some(error => error.includes('changed during verification')));
  });
});
test('passing runtime observations cannot mask a failed static check', async () => {
  await fixture({}, async result => {
    assert.equal(result.status, 'failed'); assert.equal(result.staticFailures.length, 1);
    assert.ok(result.cases[0].steps.every(step => step.status === 'passed'));
  }, scenario, true);
});
test('a failed asset export stays failed even when the remaining UI works', async () => {
  await fixture({ exportFailure: true }, async result => {
    assert.equal(result.status, 'failed'); assert.deepEqual(result.exportErrors, ['Synthetic failed asset cook']);
    assert.ok(result.cases[0].steps.every(step => step.status === 'passed'));
  });
});
