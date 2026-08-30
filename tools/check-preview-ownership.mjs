#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-preview-ownership.mjs — an offscreen preview is addressed, never
 *        entered.
 *
 * The shape refused here is a renderer that is "in preview mode": a begin, some
 * submits whose destination depends on the calls around them, and an end. It is
 * the same family as the ambient state the shadow pass and the certificate
 * transport were each moved out of, and it fails the same way — by working until
 * two callers exist.
 *
 * What replaced it: every call names a handle, the batches a preview holds own
 * their bytes, and the one shared render body takes its destination as an
 * argument. Each of those is a decision somebody could undo without noticing.
 *
 *   node tools/check-preview-ownership.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_H = 'src/esengine/renderer/frame/RenderFrame.hpp';
const FRAME_C = 'src/esengine/renderer/frame/RenderFrame.cpp';
const BINDINGS_H = 'src/esengine/bindings/RendererBindings.hpp';

const missing = [FRAME_H, FRAME_C, BINDINGS_H].filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length) {
    console.error(`check-preview-ownership is stale: ${missing.join(', ')} does not exist.`);
    process.exit(1);
}

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const RULES = [
    {
        rule: 'No renderer state says which preview is the current one. A begin/end pair makes what a submit reaches depend on the calls around it, which is correct until two callers exist.',
        holds: () => {
            const bad = [];
            for (const file of [FRAME_H, FRAME_C, BINDINGS_H]) {
                const text = strip(read(file));
                for (const m of text.matchAll(/\b(current|active|in)_?[Pp]review\w*\b/g)) {
                    bad.push(`${file} declares ${m[0]}`);
                }
                if (/\b(begin|end)SkeletalPreview\b/.test(text)) {
                    bad.push(`${file} has a begin/end preview pair`);
                }
            }
            return bad.length ? bad.join('; ') : null;
        },
    },
    {
        rule: 'Every skeletal-preview entry takes the preview it is about as its first argument. An entry without one can only mean "the current preview".',
        holds: () => {
            const text = strip(read(BINDINGS_H));
            const bad = [];
            for (const m of text.matchAll(/\b(\w*SkeletalPreview\w*)\s*\(([^)]*)\)/g)) {
                const [, name, args] = m;
                if (name.includes('create')) continue;   // creates one rather than naming one
                if (!/^\s*u32 preview\b/.test(args)) bad.push(name);
            }
            return bad.length === 0 ? null
                : `${bad.join(', ')} does not name the preview it acts on`;
        },
    },
    {
        rule: 'The shared render body takes a SPAN of batches, never a callback. A hook there becomes the place every future pass is inserted, and this is a preview rather than a second orchestration door.',
        holds: () => {
            const decl = strip(read(FRAME_H)).match(/void renderSurface\(([\s\S]*?)\);/);
            if (!decl) return 'renderSurface is gone — the shared render body was inlined again';
            return /std::function|auto&&\s*\w+|template/.test(decl[1])
                ? 'renderSurface takes a callback' : null;
        },
    },
    {
        rule: 'A preview\'s batches own their bytes. They cross the ABI and wait for a render call, so a span into the caller\'s scratch would be a lifetime protocol nobody wrote down.',
        holds: () => {
            const body = strip(read(FRAME_H)).match(/struct PendingSkeletalBatch \{([\s\S]*?)\};/);
            if (!body) return 'PendingSkeletalBatch is gone';
            if (/\bconst\s+\w+\s*\*|std::span|_ptr\b/.test(body[1])) {
                return 'PendingSkeletalBatch refers to memory it does not own';
            }
            return /std::vector<f32>[\s\S]*std::vector<u16>/.test(body[1]) ? null
                : 'PendingSkeletalBatch no longer owns its vertices and indices';
        },
    },
    {
        rule: 'Handed-over batches are replayed AFTER the collect. Before it, the draw list is cleared and they are silently dropped — which is the whole reason a preview holds them rather than submitting through.',
        holds: () => {
            const body = strip(read(FRAME_C)).match(/void RenderFrame::renderSurface\([\s\S]*?\n\}/);
            if (!body) return 'renderSurface is gone';
            const collect = body[0].indexOf('collectAll(registry)');
            // The LOOP, not the parameter — which is named in the signature above.
            const replay = body[0].search(/for\s*\([^)]*:\s*extraSkeletalBatches\s*\)/);
            const finalize = body[0].indexOf('draw_list_.finalize');
            if (collect < 0 || replay < 0 || finalize < 0) return 'renderSurface no longer collects, replays and finalizes';
            return collect < replay && replay < finalize ? null
                : 'the replay is not between the collect and the finalize';
        },
    },
    {
        rule: 'A render consumes what it was handed. Left behind, the batches would draw again under the next frame — which is a clear/submit/render protocol wearing different clothes.',
        holds: () => {
            const body = strip(read(FRAME_C)).match(/bool RenderFrame::renderSkeletalPreview\([\s\S]*?\n\}/);
            if (!body) return null;   // ownership moved; the ABI's own rule covers it
            return /std::exchange\(\s*\w+->pending/.test(body[0]) ? null
                : 'renderSkeletalPreview does not take its pending batches';
        },
    },
];

const findings = [];
for (const { rule, holds } of RULES) {
    const broken = holds();
    if (broken) findings.push(`${broken}\n    the boundary: ${rule}`);
}

if (findings.length === 0) {
    console.log(`check-preview-ownership: ${RULES.length} frozen boundaries — a preview is addressed by its handle, never entered.`);
    process.exit(0);
}
for (const f of findings) console.error(`✗ ${f}`);
console.error('\nChanging one of these is allowed — with a counterexample. Edit this file and say why.');
process.exit(1);
