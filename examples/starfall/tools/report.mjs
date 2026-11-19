import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(process.argv[2] || 'output/starfall');
const json = async name => JSON.parse(await readFile(path.join(out, name), 'utf8'));
const [functional, performance, web, wechat] = await Promise.all(['verification.json', 'performance.json', 'export-web.json', 'export-wechat.json'].map(json));
const files = [];
async function walk(dir) { for (const e of await readdir(path.join(project, dir), { withFileTypes: true })) { const name = dir + '/' + e.name; if (e.isDirectory()) await walk(name); else files.push(name); } }
await walk('src'); await walk('assets'); files.push('project.esproject'); files.sort();
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(path.join(project, file))).digest('hex');
const report = {
    recorded: new Date().toISOString(), sourceDigest: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), files: hashes,
    functional: { status: functional.status, checks: functional.checks, errors: functional.errors, warnings: functional.warnings, victory: functional.victory },
    performance,
    exports: { web: { ok: web.ok, warnings: web.warnings, bytes: web.size.totalBytes }, wechat: { ok: wechat.ok, warnings: wechat.warnings, initialBytes: wechat.size.initialBytes, totalBytes: wechat.size.totalBytes, verdicts: wechat.size.verdicts } },
    physicalDeviceAcceptance: { status: 'not-run', reason: 'No connected Android device and no target phone model or WeChat AppID supplied. Browser CPU throttling retains the desktop GPU.' },
};
await writeFile(path.join(project, 'source/verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceDigest: report.sourceDigest, functional: functional.status, performance: performance.runs.map(r => ({ throttle: r.throttle, targetMet: r.targetMet })), wechat: report.exports.wechat }));
