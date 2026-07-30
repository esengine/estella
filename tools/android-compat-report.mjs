// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  android-compat-report.mjs — one APK, every Android version, in one table.
 *
 * The compatibility matrix runs the SAME binary on one emulator per platform
 * version and files a metrics JSON and a screenshot from each. This turns that
 * pile into the thing a reviewer actually reads: a row per version, and the
 * frames side by side underneath.
 *
 * The frames are here to be LOOKED AT. Nothing in this file judges a pixel —
 * a scene that is legitimately dark and a renderer that died both produce a
 * dark PNG, and no threshold tells them apart. What is gated is what can be
 * decided without a human: did it install, did the host reach `ready`, did the
 * boot record name an error.
 *
 *   node tools/android-compat-report.mjs --dir build/compat --shots-base <url> --out comment.md
 *
 * `--shots-base` is the URL the screenshots were published under; without it the
 * table still renders and the image section says where the artifact is instead.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
    const opts = { dir: 'build/compat', out: 'compat-comment.md' };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        opts[key] = argv[++i];
    }
    return opts;
}

const opts = parseArgs(process.argv.slice(2));

/** Every metrics JSON under `--dir`, at any depth: one artifact per matrix job. */
function collect(dir) {
    const found = [];
    const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.json')) {
                try {
                    found.push(JSON.parse(readFileSync(p, 'utf8')));
                } catch {
                    // A truncated file is a job that died mid-write. Worth saying so
                    // rather than crashing the report that would have explained it.
                    found.push({ label: path.basename(p, '.json'), ok: false, why: 'its metrics file is not readable' });
                }
            }
        }
    };
    if (existsSync(dir)) walk(dir);
    return found;
}

const runs = collect(opts.dir);

// No metrics at all means the matrix never ran — the APK build failed, or every
// job died before it could file anything. Still write a comment: failing here
// instead would lose the only place that says so, and leave a red check whose
// cause is in a different job's log.
if (!runs.length) {
    mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    writeFileSync(opts.out, ['<!-- android-compat -->', '## Android 兼容性', '',
        '没有任何版本产出数据 — 说明矩阵没跑起来(APK 构建失败,或每个 job 都在写结果前就死了)。',
        '原因在 `apk` / `compat` job 的日志里,不在这里。', ''].join('\n'));
    console.error(`no metrics files under ${opts.dir} — wrote a comment saying so`);
    process.exit(0);
}

// API level ascending, so the table reads oldest-first — the direction a
// compatibility floor is read in.
runs.sort((a, b) => (a.api ?? 0) - (b.api ?? 0) || String(a.label).localeCompare(String(b.label)));

const mb = (kb) => (kb === null || kb === undefined ? '—' : `${Math.round(kb / 1024)} MB`);
const ms = (n) => (n === null || n === undefined ? '—' : `${n} ms`);
const pct = (c) => (c?.percent === null || c?.percent === undefined ? '—' : `${c.percent}%`);
const frames = (f) => (!f ? '—' : `${f.medianMs} / ${f.p95Ms} ms`);

// The label is `api<NN>-<example>`; the app column only appears when more than
// one was run, because a column with one repeated value is noise.
const appOf = (r) => String(r.label ?? '').replace(/^api\d+-?/, '') || '—';
const apps = [...new Set(runs.map(appOf))];
const perApp = apps.length > 1;

const rows = runs.map((r) => {
    const s = r.startup ?? {};
    return `| ${r.release ?? '?'} | ${r.api ?? '?'} ${perApp ? `| ${appOf(r)} ` : ''}`
        + `| ${ms(s.readyMs)} | ${ms(s.displayedMs)} | ${ms(s.totalMs)} `
        + `| ${mb(r.memory?.totalPssKb)} | ${mb(r.memory?.graphicsKb)} | ${pct(r.cpu)} | ${frames(r.frames)} `
        + `| ${r.ok ? '✓' : `✗ ${r.why || 'failed'}`} |`;
});

const out = [];
out.push('<!-- android-compat -->');
out.push('## Android 兼容性');
out.push('');
const versions = new Set(runs.map((r) => r.api));
const named = apps.filter((a) => a !== '—');
out.push(`${perApp ? `${named.length} 个包` : '同一个包'}${named.length ? `(${named.join('、')})` : ''},`
    + `在 ${versions.size} 个 Android 版本上各跑一台模拟器,每个版本装的是同一个构建产物。`);
out.push('');
// Which template was wrapped changes what a red row means: against the released
// one it is the binary users installed, against a branch build it is a proposed
// fix. Stated because the table is read without the workflow next to it.
if (opts.templateSource === 'release') {
    out.push('运行时模板取自**最新 release** —— 也就是用户实际装到手机上的那个二进制。');
} else if (opts.templateSource === 'head') {
    out.push('运行时模板**从这个分支构建** —— 测的是这里改的代码,不是已发布的版本。');
}
out.push('');
out.push(`| Android | API ${perApp ? '| app ' : ''}| ready | 首帧上屏 | am start | PSS | Graphics | CPU | 帧间隔 中位/p95 | 结果 |`);
out.push(`|---|---|${perApp ? '---|' : ''}---|---|---|---|---|---|---|---|`);
out.push(...rows);
out.push('');

const broken = runs.filter((r) => !r.ok);
if (broken.length) {
    const brokenVersions = new Set(broken.map((r) => r.api));
    out.push(`**${brokenVersions.size}/${versions.size} 个 Android 版本没跑起来**`
        + `(${broken.length}/${runs.length} 次运行失败)。`);
    out.push('');
    for (const r of broken) {
        out.push(`- **Android ${r.release ?? '?'} (API ${r.api ?? '?'})**`
            + `${perApp ? ` — ${appOf(r)}` : ''} — ${r.why || 'failed'}`);
        for (const e of (r.errors ?? []).slice(0, 3)) out.push(`  - \`${e.trim()}\``);
    }
    out.push('');
}

out.push('### 截图 — 需要人工看');
out.push('');
out.push('这里没有任何像素判据。上面的表只回答了「装上了、起来了、没报错」;');
out.push('画面对不对只有人能判断。');
out.push('');
if (opts.shotsBase) {
    // Two per row: a phone screenshot in a PR comment column is still tall enough
    // to see, and eight in a single row would each be a thumbnail nobody can read.
    for (let i = 0; i < runs.length; i += 2) {
        const pair = runs.slice(i, i + 2);
        out.push(`| ${pair.map((r) => `Android ${r.release ?? '?'} (API ${r.api ?? '?'})`
            + (perApp ? ` — ${appOf(r)}` : '')).join(' | ')} |`);
        out.push(`|${pair.map(() => '---').join('|')}|`);
        out.push(`| ${pair.map((r) => (r.shot
            ? `<img src="${opts.shotsBase}/${r.shot}" width="260">`
            : '_(没有截图)_')).join(' | ')} |`);
        out.push('');
    }
} else {
    out.push('_截图没有发布到可引用的地址,在这次 run 的 artifact 里。_');
    out.push('');
}

// The renderer is stated once, because it changes what the numbers mean rather
// than being one of them: a hosted runner has no GPU, so Dawn is on the
// emulator's SwiftShader and every frame time above is a CPU rasteriser's.
// Comparing versions against each other is still valid; reading any of it as
// device performance is not.
const renderers = [...new Set(runs.map((r) => r.renderer).filter(Boolean))];
if (renderers.length) {
    out.push('### 这些数字的边界');
    out.push('');
    out.push(`渲染器:${renderers.map((r) => `\`${r}\``).join(', ')}`);
    out.push('');
    if (renderers.some((r) => /swiftshader|llvmpipe|software/i.test(r))) {
        out.push('**是软件渲染。** runner 没有 GPU,Dawn 跑在模拟器自带的 SwiftShader 上,');
        out.push('所以上面的帧间隔是 CPU 光栅化的耗时,GPU 占用和功耗在这里根本不存在。');
        out.push('跨版本互相比较仍然有意义,把任何一个数当成真机性能则没有。');
        out.push('');
    }
}

const noted = runs.filter((r) => (r.notes ?? []).length);
if (noted.length) {
    out.push('<details><summary>没测到的项,以及原因</summary>');
    out.push('');
    for (const r of noted) {
        out.push(`- **API ${r.api ?? '?'}** — ${r.notes.join('; ')}`);
    }
    out.push('');
    out.push('</details>');
    out.push('');
}

mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
writeFileSync(opts.out, `${out.join('\n')}\n`);
console.log(`${runs.length} version(s), ${broken.length} broken → ${opts.out}`);

// The report always writes. Whether the RUN fails is the matrix job's call, not
// this summariser's — exiting non-zero here would lose the comment that says why.
