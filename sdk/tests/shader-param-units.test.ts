// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, describe, expect, it } from 'vitest';
import { reflectEsshader } from '../src/render/shaderReflect';
import { setWorldUnitsPerMeter } from '../src/ecs/worldUnits';
import { WATER_SHADER_TEMPLATE } from '../src/water/waterShader';
import { WaterBody } from '../src/water/waterPlugin';
import { WaterZone } from '../src/water/zone';
import { TERRAIN_LAYERS_SHADER_TEMPLATE, TERRAIN_SHADER_TEMPLATE } from '../src/terrain/terrainShader';

const SOURCE = `#pragma shader "T"
#pragma param u_reach float default(250) range(10,4000) unit(length)
#pragma param u_density float default(0.0012) range(0,0.04) unit(perLength)
#pragma param u_gain float default(2) range(0,4)
`;
const param = (source: string, name: string) => reflectEsshader(source).params.find((p) => p.name === name)!;

describe('a shader param that is a world length', () => {
    afterEach(() => setWorldUnitsPerMeter(100));

    it('reads as declared at the reference of 100 units a metre', () => {
        expect(param(SOURCE, 'u_reach').default).toEqual([250]);
        expect(param(SOURCE, 'u_density').default).toEqual([0.0012]);
    });

    it('follows the project: a length by the scale, a rate per length by its inverse, a plain number not at all', () => {
        setWorldUnitsPerMeter(1);
        expect(param(SOURCE, 'u_reach').default[0]).toBeCloseTo(2.5, 9);
        expect(param(SOURCE, 'u_reach').range).toEqual({ min: 0.1, max: 40 });
        expect(param(SOURCE, 'u_density').default[0]).toBeCloseTo(0.12, 9);
        expect(param(SOURCE, 'u_gain').default).toEqual([2]);
    });

    it('is how the ground says its lengths: a layer 24 m across, relief of 5 cm, the wet line where the scene puts it', () => {
        const ground = TERRAIN_SHADER_TEMPLATE.source, layered = TERRAIN_LAYERS_SHADER_TEMPLATE.source;
        expect(param(ground, 'u_tile0').default).toEqual([2400]);
        expect(param(ground, 'u_relief').default).toEqual([5]);
        setWorldUnitsPerMeter(1);
        expect(param(ground, 'u_tile0').default[0]).toBeCloseTo(24, 9);
        expect(param(ground, 'u_tile3').default[0]).toBeCloseTo(40, 9);
        expect(param(ground, 'u_relief').default[0]).toBeCloseTo(0.05, 9);
        // A slider's reach is a length too: either ground shader's wet line can be put a kilometre up, whatever a unit is.
        for (const source of [ground, layered]) {
            for (const name of ['u_wetLevel', 'u_wetBand']) expect(param(source, name).range!.max).toBeCloseTo(1000, 9);
        }
    });

    it('is how the water says its lengths: the same water in a centimetre project and a metre one', () => {
        const lengths = ['u_waveLength', 'u_rippleLength', 'u_distortionRange', 'u_foamWidth', 'u_fallbackDepth', 'u_causticScale'];
        const cm = lengths.map((n) => param(WATER_SHADER_TEMPLATE.source, n).default[0]!);
        setWorldUnitsPerMeter(1);
        lengths.forEach((n, i) => expect(param(WATER_SHADER_TEMPLATE.source, n).default[0]).toBeCloseTo(cm[i]! / 100, 9));
        expect(param(WATER_SHADER_TEMPLATE.source, 'u_density').default[0]).toBeCloseTo(0.12, 9);
        // And the components that place it: a 100 m lake with 30 cm waves, 14 m swell on 1 m cells.
        const body = WaterBody._default, zone = WaterZone._default;
        expect([body.sizeX, body.waveHeight, body.shoreWidth]).toEqual([100, 0.3, 3]);
        expect([zone.waveLength, zone.cellSize, zone.surfLength]).toEqual([14, 1, 8]);
    });
});
