// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Regenerate the light-probe fixtures: four grids solved by hand, as the INVERSE
 * of the shader's basis — irradiance `c` everywhere means a constant term of
 * `c / 0.282095`. That is what lets a gate name an exact pixel.
 *
 *   node tools/make-probe-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { importSdkSource } from './lib/sdkSource.mjs';

const { encodeProbeFile, PROBE_FILE_VERSION } = await importSdkSource('lightmap/probeFile.ts');
const { stitchBricks } = await importSdkSource('lightmap/probes.ts');

const OUT = path.join(ROOT, 'fixtures', 'scenes');

/** The shader's basis at order zero and at the +X lobe — ShaderParser's numbers. */
const Y00 = 0.282095;
const Y11 = 0.488603;

/** Nine RGB coefficients whose irradiance is `rgb` from every direction. */
function constant(rgb) {
    const sh = new Array(27).fill(0);
    for (let c = 0; c < 3; c++) sh[c] = rgb[c] / Y00;
    return sh;
}

/** The same, plus `rgb` more wherever the normal points along +X. */
function alongX(base, rgb) {
    const sh = constant(base);
    for (let c = 0; c < 3; c++) sh[9 + c] = rgb[c] / Y11;
    return sh;
}

const RED = [1, 0, 0];
const BLUE = [0, 0, 1];
const GREY = [0.5, 0.5, 0.5];

const FIXTURES = {
    // One probe: a volume may be a constant field, and that is the case a grid of
    // one exercises — including the read, which must not divide by a zero span.
    'probe-red.esprobes': { resolution: [1, 1, 1], irradiance: constant(RED) },
    'probe-blue.esprobes': { resolution: [1, 1, 1], irradiance: constant(BLUE) },
    // Grey everywhere, red only where a surface faces +X. The fixture mesh's two
    // triangles face +Z and +X, so one draw shows both halves of the claim.
    'probe-facing.esprobes': { resolution: [1, 1, 1], irradiance: alongX(GREY, [0.5, 0, 0]) },
    // Red at one end, blue at the other: what stands between them must be neither. Written in the current binary
    // version, while the three above stay version 1 JSON, so the gates load both kinds of file a project may hold.
    'probe-ends.esprobes': {
        resolution: [2, 1, 1],
        irradiance: [...constant(RED), ...constant(BLUE)],
        binary: true,
    },
    // The same red-to-blue field as a SPARSE grid (version 3): nine probes along x held by one brick of span 2, so
    // its five probes per axis sit two finest probes apart. A read that ignored the span would land on the wrong
    // probes and paint the middle the wrong mix; the gate expects what probe-per-pixel does.
    'probe-ends-sparse.esprobes': {
        resolution: [9, 1, 1],
        bricks: [0, 0, 0, 2],
        irradiance: Array.from({ length: 125 }, (_, t) => {
            const u = Math.min((t % 5) * 2, 8) / 8;
            return constant(RED).map((r, i) => r * (1 - u) + constant(BLUE)[i] * u);
        }).flat(),
        binary: true,
    },
    // A SEAM: one span-2 brick (x cells 0-1) beside four span-1 bricks (x cells 2-3), 17 x 9 x 1 probes. Red
    // everywhere, except the fine bricks' probes ON the shared face at odd y, which are blue: a bump the coarse face,
    // blending probes two apart, cannot hold. Stitched as a bake stitches it, the fine face takes the coarse brick's
    // red and the light is red across the seam; unstitched, the fine side of the seam turns blue.
    'probe-seam.esprobes': (() => {
        const resolution = [17, 9, 1];
        const bricks = [0, 0, 0, 2, 2, 0, 0, 1, 3, 0, 0, 1, 2, 1, 0, 1, 3, 1, 0, 1];
        const values = new Float32Array((bricks.length / 4) * 125 * 27);
        for (let b = 0; b < bricks.length / 4; b++) {
            for (let t = 0; t < 125; t++) {
                const fx = bricks[b * 4] * 4 + (t % 5) * bricks[b * 4 + 3];
                const fy = bricks[b * 4 + 1] * 4 + (Math.floor(t / 5) % 5) * bricks[b * 4 + 3];
                const bump = bricks[b * 4 + 3] === 1 && fx === 8 && fy % 2 === 1;
                values.set(constant(bump ? BLUE : RED), (b * 125 + t) * 27);
            }
        }
        if (!process.env.PROBE_SEAM_UNSTITCHED) stitchBricks(resolution, Int32Array.from(bricks), values, 27);
        return { resolution, bricks, irradiance: Array.from(values), binary: true };
    })(),
};

for (const [name, data] of Object.entries(FIXTURES)) {
    if (data.binary) {
        const bytes = encodeProbeFile({ version: PROBE_FILE_VERSION, resolution: data.resolution, irradiance: data.irradiance,
                                        ...(data.bricks ? { bricks: data.bricks } : {}) });
        writeFileSync(path.join(OUT, name), bytes);
        console.log(`wrote ${name}: ${data.resolution.join('x')} probes, version ${new DataView(bytes.buffer).getUint16(4, true)}`);
        continue;
    }
    const doc = { version: 1, resolution: data.resolution, irradiance: data.irradiance };
    // One line per member: a grid is hundreds of numbers, and a diff of it is
    // worth reading only if the numbers stay where they were.
    const text = `{\n  "version": ${doc.version},\n`
        + `  "resolution": ${JSON.stringify(doc.resolution)},\n`
        + `  "irradiance": ${JSON.stringify(doc.irradiance)}\n}\n`;
    writeFileSync(path.join(OUT, name), text);
    console.log(`wrote ${name}: ${data.resolution.join('x')} probes`);
}
