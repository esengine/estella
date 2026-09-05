#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-postfx-aa.mjs — a post-process chain must not cost the frame its
 *        antialiasing.
 *
 * A WebGL2 canvas gives the default framebuffer 4x multisampling. A chain draws
 * the scene into a target the engine made instead, so THAT target has to carry
 * the sample count and resolve itself — or an effect that changes no colour at
 * all still flattens every edge in the frame, which is what it did.
 *
 * The pixel criteria (aa-edge / aa-edge-post) say the coverage is there. They
 * cannot say where it came from, because a screen-space filter smeared along the
 * edges reproduces the same greys. So the ownership is asserted here instead.
 *
 * Run: node tools/check-postfx-aa.mjs   (exit 1 on a violation)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPE_CPP = 'src/esengine/renderer/frame/PostProcessPipeline.cpp';
const FB_CPP = 'src/esengine/renderer/rhi/Framebuffer.cpp';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const findings = [];

const pipe = read(PIPE_CPP);

// 1. The scene target — the one target geometry is rasterised into — takes its
//    sample count from the effective member, never from a literal.
const assign = /sceneDesc\.samples\s*=\s*([^;]+);/.exec(pipe);
if (!assign) {
    findings.push(`${PIPE_CPP}: the scene target sets no sample count — a post chain would `
        + 'draw the scene single-sampled and the frame would lose its edges.');
} else if (assign[1].trim() !== 'scene_samples_') {
    findings.push(`${PIPE_CPP}: the scene target's sample count is \`${assign[1].trim()}\`, not `
        + 'scene_samples_. A literal here is how the chain silently drops antialiasing.');
}

// 2. The effective count is a REQUEST clamped by a CAPABILITY. A device that
//    decides quality drags every low-end target up to whatever its driver
//    allows; a request nobody clamps asks for samples that cannot be created.
const derived = /scene_samples_\s*=\s*([^;]+);/.exec(pipe);
if (!derived) {
    findings.push(`${PIPE_CPP}: scene_samples_ is never assigned.`);
} else {
    const expr = derived[1].replace(/\s+/g, ' ').trim();
    if (!/maxSamples\s*\(\s*\)/.test(expr)) {
        findings.push(`${PIPE_CPP}: the effective sample count \`${expr}\` is never clamped by `
            + 'device.maxSamples(). A target cannot be created with more samples than the '
            + 'backend has.');
    }
    if (!/requested_samples_/.test(expr)) {
        findings.push(`${PIPE_CPP}: the effective sample count \`${expr}\` does not come from a `
            + 'request. maxSamples() answers what the device CAN do, never what the project '
            + 'SHOULD do — let it decide and every low-end target inherits its driver.');
    }
}

// 3. The request reaches the pipeline from outside it. Without a setter the
//    policy is a constant in the renderer, which is the same mistake one level up.
if (!/void PostProcessPipeline::setRequestedSamples/.test(pipe)) {
    findings.push(`${PIPE_CPP}: nothing outside the renderer can set the multisampling `
        + 'request, so the policy lives in the backend after all.');
}

// 4. A multisampled target resolves ITSELF. Without the resolve attachments a
//    sampler reads the multisampled side, which cannot be sampled at all.
const fb = read(FB_CPP);
if (!/resolveColor_\s*=\s*device_->createTexture/.test(fb)) {
    findings.push(`${FB_CPP}: a multisampled target no longer creates the single-sample `
        + 'attachment it resolves into. Resolve is the target\'s own business — a pass or an '
        + 'effect must never have to ask for it.');
}
if (!/createFramebuffer\(\{[^}]*resolveColor_/s.test(fb)) {
    findings.push(`${FB_CPP}: the resolve attachments are created but not handed to `
        + 'createFramebuffer, so the device has nothing to resolve into.');
}

// 5. WebGPU answers 1 because it has no MSAA. That API resolves COLOUR only, so
//    raising the ceiling without an engine-owned depth resolve hands every
//    depth-reading effect an attachment it cannot sample.
const WGPU_CPP = 'src/esengine/renderer/webgpu/WebGPUDevice.cpp';
const wgpu = read(WGPU_CPP);
const ceiling = /u32 WebGPUDevice::maxSamples\(\)\s*\{\s*return\s+([^;]+);/.exec(wgpu);
if (!ceiling) {
    findings.push(`${WGPU_CPP}: WebGPUDevice::maxSamples() is gone or unrecognisable.`);
} else if (ceiling[1].trim() !== '1' && !/texture_depth_multisampled_2d|resolveDepth/.test(wgpu)) {
    findings.push(`${WGPU_CPP}: maxSamples() now answers \`${ceiling[1].trim()}\` with no depth `
        + 'resolve in sight. WebGPU resolves colour only, and a multisampled colour attachment '
        + 'forces a multisampled depth one that no post effect can sample — SSAO, fog and '
        + 'depth-outline would read an attachment they cannot read.');
}

if (findings.length) {
    console.error('check-postfx-aa: the chain may cost the frame its antialiasing.\n');
    for (const f of findings) console.error(`  - ${f}`);
    console.error('\nSee tools/check-postfx-aa.mjs for why this is a gate.');
    process.exit(1);
}
console.log('check-postfx-aa: the scene target owns its sample count and resolves itself.');
