// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlayablePreview } from './playable-preview.mjs';

const NETWORKS = ['generic', 'mraid', 'unity', 'applovin', 'mintegral', 'tiktok', 'pangle', 'google', 'meta'];
const LIFECYCLE = ['mraid', 'unity', 'applovin', 'mintegral', 'tiktok', 'pangle'];
const sha = value => createHash('sha256').update(value).digest('hex');
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/** Declarative input only: scenarios cannot inject code or choose a headed browser. */
export function validatePlayableScenario(scenario) {
  const object = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
  const networks = value => value === undefined || (Array.isArray(value) && value.length > 0 && value.every(id => NETWORKS.includes(id)));
  if (!object(scenario, ['version', 'description', 'viewports', 'steps']) || scenario.version !== 1
    || !Array.isArray(scenario.viewports) || !integer(scenario.viewports.length, 1, 4)
    || !scenario.viewports.every(v => object(v, ['width', 'height']) && integer(v.width, 1, 4096) && integer(v.height, 1, 4096))
    || !Array.isArray(scenario.steps) || !integer(scenario.steps.length, 1, 200)) throw new Error('Scenario needs version 1, 1–4 viewports and 1–200 steps.');
  for (const [index, step] of scenario.steps.entries()) {
    const fields = { click: ['x', 'y', 'expect', 'observeMs'], host: ['command'], wait: ['ms'], frozen: ['ms'], snapshot: [] };
    if (!object(step, ['type', 'name', 'networks', ...(fields[step?.type] ?? [])]) || !networks(step.networks)
      || (step.name !== undefined && typeof step.name !== 'string')) throw new Error(`Invalid scenario step ${index + 1}.`);
    if (step.type === 'click') {
      if (![step.x, step.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
        || (step.observeMs !== undefined && !integer(step.observeMs, 100, 2000))) throw new Error(`Click ${index + 1} needs normalized canvas coordinates and a bounded observation interval.`);
      if (step.expect !== undefined && (!object(step.expect, ['event', 'count', 'userActivation', 'networks'])
        || !['store-click', 'game-end', 'game-retry'].includes(step.expect.event) || !integer(step.expect.count, 0, 20)
        || !networks(step.expect.networks) || (step.expect.userActivation !== undefined && typeof step.expect.userActivation !== 'boolean'))) throw new Error(`Invalid event expectation at step ${index + 1}.`);
    } else if (step.type === 'host') {
      if (!['ready', 'show', 'hide'].includes(step.command)) throw new Error(`Invalid host command at step ${index + 1}.`);
    } else if (step.type === 'wait' || step.type === 'frozen') {
      if (!integer(step.ms, 100, step.type === 'frozen' ? 2000 : 10000)) throw new Error(`Invalid wait interval at step ${index + 1}.`);
    } else if (step.type !== 'snapshot') throw new Error(`Unknown scenario action ${step.type}.`);
  }
  return scenario;
}

/** Runs in the creative before its scripts; observation does not call game handlers. */
function installProbe() {
  const probe = { events: [], dropped: 0, drawCalls: 0, pointerUps: 0, lastPointerTrusted: false };
  window.__ESTELLA_PLAYABLE_CHECK__ = probe;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'estella-playable-preview' || event.data.type !== 'event') return;
    if (probe.events.length >= 4096) { probe.dropped++; return; }
    probe.events.push({ ...event.data, timeMs: Math.round(performance.now()) });
  });
  window.addEventListener('pointerup', event => { probe.pointerUps++; probe.lastPointerTrusted = event.isTrusted; }, true);
  for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
    if (!proto) continue;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...args) { const result = original.apply(this, args); probe.drawCalls++; return result; };
    }
  }
}

/** Requested observations in a local mock; this never upgrades network/device acceptance. */
export async function verifyPlayable({ htmlFile, reportFile, scenarioFile, outDir, network, storeUrl = '', timeoutMs = 15000, chromium, onProgress = () => {} }) {
  if (!integer(timeoutMs, 1000, 60000)) throw new Error('Timeout must be 1000–60000 ms.');
  const scenarioBytes = await readFile(scenarioFile), scenario = validatePlayableScenario(JSON.parse(scenarioBytes));
  const reportBytes = reportFile ? await readFile(reportFile) : undefined;
  const exported = reportBytes ? JSON.parse(reportBytes) : undefined;
  const staticReport = exported?.playableCheck ?? exported;
  const verifierSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  const mockSha256 = sha(await readFile(new URL('./playable-preview.mjs', import.meta.url)));
  const preview = await createPlayablePreview({ htmlFile, reportFile, network, storeUrl });
  const result = { version: 1, mode: 'local-mock', status: 'checks-passed', headless: true,
    network: preview.network, identityScope: preview.deliverySha256 ? 'delivery' : 'html-only',
    htmlSha256: preview.htmlSha256, deliverySha256: preview.deliverySha256, deliveryFile: preview.deliveryFile,
    scenarioSha256: sha(scenarioBytes), exportReportSha256: reportBytes ? sha(reportBytes) : undefined,
    verifierSha256, mockSha256, storeUrl,
    staticFailures: Array.isArray(staticReport?.checks) ? staticReport.checks.filter(check => check.status === 'fail') : [],
    exportErrors: Array.isArray(exported?.errors) ? exported.errors : [],
    pending: ['Original host SDK behavior (the mock substitutes it)', 'Official network acceptance', 'Device acceptance', 'Visual and audio quality review', 'Audio lifecycle was not observed'],
    requestedCoverage: {
      cta: scenario.steps.some(step => step.type === 'click' && step.expect?.event === 'store-click' && step.expect.count > 0 && (!step.networks || step.networks.includes(preview.network)) && (!step.expect.networks || step.expect.networks.includes(preview.network))),
      hiddenLifecycle: scenario.steps.some(step => step.type === 'host' && step.command === 'hide' && (!step.networks || step.networks.includes(preview.network))),
      dynamicRequests: true,
    }, cases: [], errors: [] };
  if (!result.requestedCoverage.cta) result.pending.push('CTA interaction was not requested by this scenario');
  if (!result.requestedCoverage.hiddenLifecycle) result.pending.push('Hidden lifecycle was not requested for this network');
  if (!Array.isArray(staticReport?.checks)) result.pending.push('Static export checks were not provided');
  let browser;
  try {
    await mkdir(outDir, { recursive: true });
    if (reportFile && sha(await readFile(reportFile)) !== sha(reportBytes)) throw new Error('Export report changed during setup.');
    chromium ??= (await import('playwright')).chromium;
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
    result.browser = { name: 'chromium', version: browser.version(), node: process.version };
    for (const [caseIndex, viewport] of scenario.viewports.entries()) {
      const record = { viewport, steps: [], requests: [], pageErrors: [], dialogs: [], popups: 0, screenshots: [], events: [], truncatedEvents: 0 };
      result.cases.push(record);
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      let page;
      try {
        const origin = new URL(preview.url).origin;
        await context.route('**/*', async route => {
          if (new URL(route.request().url()).origin !== origin) await route.abort();
          else await route.continue();
        });
        context.on('request', request => {
          const url = new URL(request.url());
          if (!['http:', 'https:'].includes(url.protocol)) return;
          const type = request.resourceType();
          const allowed = (url.pathname === '/creative' && type === 'document' && !record.requests.some(item => item.type === 'document'))
            || (url.pathname === '/host-sdk.js' && type === 'script') || (url.pathname === '/favicon.ico' && type === 'other');
          record.requests.push({ url: url.origin + url.pathname, method: request.method(), type,
            expected: url.origin === origin && request.method() === 'GET' && allowed });
        });
        context.on('page', popup => { if (page && popup !== page) { record.popups++; void popup.close().catch(() => {}); } });
        page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        page.on('pageerror', error => record.pageErrors.push(error.message));
        page.on('dialog', dialog => { record.dialogs.push({ type: dialog.type(), message: dialog.message().slice(0, 1024) }); void dialog.dismiss().catch(() => {}); });
        page.on('websocket', socket => record.requests.push({ url: socket.url(), type: 'websocket', expected: false }));
        await page.addInitScript(installProbe);
        await page.goto(`${preview.url}creative?store=${encodeURIComponent(storeUrl)}`, { waitUntil: 'domcontentloaded' });
        const events = () => page.evaluate(() => window.__ESTELLA_PLAYABLE_CHECK__.events);
        const host = async command => {
          if (command === 'ready' && preview.network === 'mintegral') throw new Error('Mintegral readiness is announced by the creative, not the host.');
          if (command === 'hide' && !LIFECYCLE.includes(preview.network)) throw new Error(`The mock has no verified hide lifecycle for ${preview.network}.`);
          const before = (await events()).length;
          await page.evaluate(command => window.postMessage({ source: 'estella-playable-preview', type: 'command', command }, location.origin), command);
          await page.waitForFunction(({ command, before }) => window.__ESTELLA_PLAYABLE_CHECK__.events.slice(before).some(event => event.name === 'host-command' && event.data.command === command), { command, before });
          await page.waitForTimeout(100);
        };
        if (['mraid', 'unity', 'applovin'].includes(preview.network)) {
          await page.waitForFunction(() => window.__ESTELLA_PLAYABLE_CHECK__.events.some(event => event.name === 'listener-added' && event.data.name === 'ready'));
          await host('ready');
        } else if (preview.network === 'mintegral') {
          await page.waitForFunction(() => window.__ESTELLA_PLAYABLE_CHECK__.events.some(event => event.name === 'creative-ready'));
        } else await page.waitForFunction(() => window.__ESTELLA_PLAYABLE_CHECK__.events.some(event => event.name === 'mock-installed'));
        await host('show');
        await page.waitForFunction(() => window.__ESTELLA_PLAYABLE_CHECK__.drawCalls > 0);
        await page.waitForFunction(() => window.__estellaIdentDone === true);
        const canvas = page.locator('canvas').first();
        for (const [stepIndex, step] of scenario.steps.entries()) {
          const outcome = { index: stepIndex + 1, name: step.name ?? step.type, type: step.type, command: step.command, status: 'running' };
          record.steps.push(outcome);
          if (step.networks && !step.networks.includes(preview.network)) { outcome.status = 'not-applicable'; continue; }
          if (step.type === 'host') await host(step.command);
          else if (step.type === 'wait') await page.waitForTimeout(step.ms);
          else if (step.type === 'frozen') {
            const before = await canvas.screenshot(); await page.waitForTimeout(step.ms);
            const after = await canvas.screenshot(); outcome.beforeSha256 = sha(before); outcome.afterSha256 = sha(after); outcome.observeMs = step.ms;
            for (const [suffix, bytes] of [['before', before], ['after', after]]) {
              const name = `case-${caseIndex + 1}-step-${stepIndex + 1}-${suffix}.png`;
              await writeFile(path.join(outDir, name), bytes); record.screenshots.push({ file: name, sha256: sha(bytes) });
            }
            if (outcome.beforeSha256 !== outcome.afterSha256) throw new Error(`Step ${stepIndex + 1}: hidden canvas changed during the observation interval.`);
          } else if (step.type === 'snapshot') {
            const name = `case-${caseIndex + 1}-step-${stepIndex + 1}.png`, bytes = await canvas.screenshot();
            await writeFile(path.join(outDir, name), bytes); record.screenshots.push({ file: name, sha256: sha(bytes) });
          } else {
            const before = (await events()).length, pointers = await page.evaluate(() => window.__ESTELLA_PLAYABLE_CHECK__.pointerUps);
            const rect = await canvas.boundingBox(); if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error('Canvas has no clickable area.');
            await page.mouse.click(rect.x + rect.width * step.x, rect.y + rect.height * step.y, { delay: 40 });
            outcome.trustedPointer = await page.evaluate(pointers => window.__ESTELLA_PLAYABLE_CHECK__.pointerUps === pointers + 1 && window.__ESTELLA_PLAYABLE_CHECK__.lastPointerTrusted, pointers);
            if (!outcome.trustedPointer) throw new Error(`Step ${stepIndex + 1}: no trusted pointer release observed.`);
            const expected = step.expect && (!step.expect.networks || step.expect.networks.includes(preview.network)) ? step.expect : undefined;
            if (expected) outcome.expected = expected;
            if (expected?.count > 0) {
              try { await page.waitForFunction(({ before, expected }) => window.__ESTELLA_PLAYABLE_CHECK__.events.slice(before).filter(event => event.name === expected.event).length >= expected.count, { before, expected }); }
              catch {
                outcome.observedCount = (await events()).slice(before).filter(event => event.name === expected.event).length;
                throw new Error(`Step ${stepIndex + 1}: expected ${expected.count} ${expected.event} event(s), observed ${outcome.observedCount}.`);
              }
            }
            outcome.observeMs = step.observeMs ?? 300;
            await page.waitForTimeout(outcome.observeMs);
            if (expected) {
              const observed = (await events()).slice(before).filter(event => event.name === expected.event);
              outcome.expected = expected; outcome.observedCount = observed.length;
              if (observed.length !== expected.count || (expected.userActivation && observed.some(event => !event.gesture))) throw new Error(`Step ${stepIndex + 1}: ${expected.event} count or active user activation did not match.`);
            } else if (step.expect) outcome.expectationStatus = 'not-applicable';
          }
          outcome.status = 'passed';
          onProgress({ case: caseIndex + 1, step: stepIndex + 1, name: outcome.name });
        }
        await page.waitForTimeout(300);
      } catch (error) {
        record.error = error.message; result.status = 'failed';
        if (record.steps.at(-1)?.status === 'running') record.steps.at(-1).status = 'failed';
      }
      finally {
        if (page) {
          const probe = await page.evaluate(() => window.__ESTELLA_PLAYABLE_CHECK__ && ({ events: window.__ESTELLA_PLAYABLE_CHECK__.events, dropped: window.__ESTELLA_PLAYABLE_CHECK__.dropped, drawCalls: window.__ESTELLA_PLAYABLE_CHECK__.drawCalls, pointerUps: window.__ESTELLA_PLAYABLE_CHECK__.pointerUps })).catch(() => null);
          if (probe) { record.events = probe.events; record.truncatedEvents = probe.dropped; record.drawCalls = probe.drawCalls; record.pointerUps = probe.pointerUps; }
          else record.error ??= 'Creative observation state was lost.';
          const bytes = await page.locator('canvas').first().screenshot().catch(() => null);
          if (bytes) { const name = `case-${caseIndex + 1}-final.png`; await writeFile(path.join(outDir, name), bytes); record.screenshots.push({ file: name, sha256: sha(bytes) }); }
        }
        if (record.error || record.truncatedEvents || record.pageErrors.length || record.dialogs.length || record.popups
          || record.requests.some(request => !request.expected) || record.events.some(event => ['page-error', 'blocked-request'].includes(event.name))) result.status = 'failed';
        await context.close();
      }
    }
    if (sha(await readFile(htmlFile)) !== preview.htmlSha256 || sha(await readFile(scenarioFile)) !== result.scenarioSha256
      || (reportFile && sha(await readFile(reportFile)) !== result.exportReportSha256)
      || (preview.deliverySha256 && sha(await readFile(path.join(path.dirname(path.resolve(htmlFile)), preview.deliveryFile))) !== preview.deliverySha256)) throw new Error('An input artifact changed during verification.');
    if (result.staticFailures.length || staticReport?.status === 'failed' || exported?.ok === false) result.status = 'failed';
  } catch (error) { result.status = 'failed'; result.errors.push(error.message); }
  finally {
    if (browser) await browser.close().catch(error => { result.status = 'failed'; result.errors.push(`Browser cleanup: ${error.message}`); });
    await preview.close();
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'runtime-check.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), allowed = ['scenario', 'report', 'out', 'network', 'store-url', 'timeout'];
  if (!args.length || args.includes('--help')) {
    console.log('node tools/verify-playable.mjs <index.html> --scenario <scenario.json> --out <directory> [--report <export-result.json>] [--network <id>] [--store-url <url>] [--timeout <ms>]\nAlways headless. Requires Playwright Chromium (pnpm exec playwright install chromium). Results are local mocks, not network/device approval.');
  } else {
    try {
      const options = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        if (!args[i].startsWith('--') || !allowed.includes(key) || !args[i + 1] || options[key] !== undefined) throw new Error('Unknown, missing or duplicate option. Use --help.');
        options[key] = args[i + 1];
      }
      if (!options.scenario || !options.out) throw new Error('--scenario and --out are required.');
      verifyPlayable({ htmlFile: path.resolve(args[0]), reportFile: options.report && path.resolve(options.report),
        scenarioFile: path.resolve(options.scenario), outDir: path.resolve(options.out), network: options.network,
        storeUrl: options['store-url'], timeoutMs: Number(options.timeout ?? 15000),
        onProgress: value => console.log(`Case ${value.case}, step ${value.step}: ${value.name}`),
      }).then(result => { console.log(`${result.status} · local-mock · ${result.cases.length} viewport(s)\n${path.resolve(options.out, 'runtime-check.json')}`); process.exitCode = result.status === 'checks-passed' ? 0 : 1; })
        .catch(error => { console.error(error.message); process.exitCode = 1; });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
