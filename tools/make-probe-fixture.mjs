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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    // Red at one end, blue at the other: what stands between them must be neither.
    'probe-ends.esprobes': {
        resolution: [2, 1, 1],
        irradiance: [...constant(RED), ...constant(BLUE)],
    },
};

for (const [name, data] of Object.entries(FIXTURES)) {
    const doc = { version: 1, resolution: data.resolution, irradiance: data.irradiance };
    // One line per member: a grid is hundreds of numbers, and a diff of it is
    // worth reading only if the numbers stay where they were.
    const text = `{\n  "version": ${doc.version},\n`
        + `  "resolution": ${JSON.stringify(doc.resolution)},\n`
        + `  "irradiance": ${JSON.stringify(doc.irradiance)}\n}\n`;
    writeFileSync(path.join(OUT, name), text);
    console.log(`wrote ${name}: ${data.resolution.join('x')} probes`);
}
