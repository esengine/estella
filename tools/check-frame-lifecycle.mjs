// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-frame-lifecycle.mjs — a frame's resources go back at the FRAME's
 *        end, not at a camera's.
 *
 * `GfxDevice::endFrame` is where a backend that borrows the swapchain image for
 * the duration of a frame gives it back. `RenderFrame::begin`/`end` bracket one
 * CAMERA, so releasing there means everything drawn afterwards — a second
 * camera, the screen post stack, the screen overlay — draws into an image the
 * surface has already taken away, and re-acquiring one is an error whose only
 * symptom is a black frame.
 *
 * A pixel gate cannot hold this everywhere: the GL backends implement endFrame
 * as a no-op, so on WebGL2 the wrong ordering looks identical. The behaviour is
 * gated on the second backend (CI runs the pr tier on a real Metal GPU, and
 * ui-screen-post crosses camera → post → overlay → frame end). This is the half
 * that holds on every machine: who is allowed to say the frame is over.
 *
 *   node tools/check-frame-lifecycle.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source with block and line comments removed. Strings are left as they are —
 *  none of the patterns below can appear in one without also being a call. */
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Where the device may be told the frame is over. ONE place: closing it
 * anywhere else costs a host that does honour the pairing its booked capture,
 * which is served against an image the earlier close already released.
 * `test_frame_lifecycle` holds the count this rule cannot see.
 */
const OWNERS = ['RenderFrame::endFrame'];

/** Which C++ function a line falls inside — `Class::name(` at column zero. */
function enclosingFunction(lines, index) {
    for (let i = index; i >= 0; i--) {
        const m = /^[A-Za-z_][\w:<>,\s*&]*?\b([A-Za-z_]\w*::[A-Za-z_]\w*)\s*\(/.exec(lines[i]);
        if (m) return m[1];
    }
    return '<file scope>';
}

const problems = [];

// ---- 1. Only the frame's own owner releases the frame ----------------------
const { files } = listTrackedSources(['src']);
for (const file of files.filter((f) => f.endsWith('.cpp'))) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
        if (!/\bdevice_?\.endFrame\s*\(|\bdevice_->endFrame\s*\(/.test(line)) continue;
        const owner = enclosingFunction(lines, i);
        if (OWNERS.includes(owner)) continue;
        problems.push(`${file}:${i + 1} releases the frame from ${owner}() — `
            + `only ${OWNERS.join(' / ')} may (see this file's header)`);
    }
}

// ---- 2. A host that opens a frame closes it --------------------------------
// Textual, deliberately: the pairing is a fact about a call site and there are
// few. A host that opens without closing holds the image until the next frame.
const HOSTS = ['sdk/src', 'native/host', 'tools/render-host'];
const OPEN = /\b(?:Renderer|pipeline|rf|renderFrame)\.beginFrame\s*\(|->beginFrame\s*\(\s*\)/;
const CLOSE = /\b(?:Renderer|pipeline|rf|renderFrame)\.endFrame\s*\(|->endFrame\s*\(\s*\)/;
const { files: hostFiles, missing } = listTrackedSources(HOSTS);
if (missing.length) {
    console.log(`check-frame-lifecycle: not scanned — ${missing.join(', ')}`);
}
for (const file of hostFiles.filter((f) => /\.(ts|cpp|mjs)$/.test(f))) {
    // Comments stripped first: a commented-out close still reads as a close, and
    // a gate that a `//` can satisfy is worth less than none.
    const text = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
    // The façade and the pipeline DECLARE both halves rather than driving them.
    if (/renderer\.ts$|renderPipeline\.ts$|nativeRenderer\.ts$/.test(file)) continue;
    if (OPEN.test(text) && !CLOSE.test(text)) {
        problems.push(`${file} opens a frame and never closes it — beginFrame's pair is endFrame`);
    }
}

for (const p of problems) console.log(`✗ ${p}`);
console.log(problems.length === 0
    ? 'check-frame-lifecycle: the frame is released by the frame, and every host that opens one closes it'
    : `check-frame-lifecycle: ${problems.length} finding(s)`);
process.exit(problems.length === 0 ? 0 : 1);
