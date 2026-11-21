// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterPlugin.ts
 * @brief   Bodies of water, the zone they are baked into, the one surface drawn from it, and the surface they answer questions about.
 *
 * @details A `WaterBody` says what water is where: an ocean, a lake inside an outline, a river along a Spline, each with the height its waves
 *          stand to and how far in from its shore they calm. It is not drawn on its own: the bodies are inputs to a zone (zone.ts), which bakes
 *          them over its region into one field (the surface's height, the shore, the waves' height, the current) where rivers run into lakes and
 *          lakes into the sea with no seam. One mesh of rings following the camera reads the field and is every body's surface; the zone's
 *          `WaterZone` component (or, without one, a zone over every lake and river with its defaults) says where, how fine, the waves every
 *          body shares and the material.
 *
 *          The waves are the ones the Water shader draws: `waves.ts` is the same formula, and {@link Waters.sample} answers from the same field, so
 *          a floating object, a camera under the surface and a splash all read the surface that is on the screen.
 */
import { EditorView, editorViewpoint } from '../camera/EditorView';
import type { WaterQueryData } from './waterQuery';
import { riverBedModifiers } from './riverBed';
import { BLEND_ADDITIVE, BLEND_ALPHA, BLEND_MAX, BLEND_MIN, ChannelFalloff, FALLOFF_ANGLE, FALLOFF_WIDTH, islandModifier, lakeChannelModifier, lakeFloorModifier, type ChannelSettings, type OutlineSpace } from './landShape';
import { InterpType, sampleKeyframes, type Curve } from '../math/keyframes';
import { Footprint } from './footprint';
import type { TerrainModifier } from '../terrain/source';
import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource, Time } from '../ecs/resource';
import {
    defineComponent, Camera, MeshRenderer, Transform,
    type ComponentDef, type CameraData, type MeshRendererData, type TransformData,
} from '../ecs/component';
import { Assets } from '../asset/AssetPlugin';
import type { MaterialShaderSource } from '../asset/loaders/MaterialShaderAssetLoader';
import { Material, MATERIAL_FORMAT_VERSION } from '../render/material';
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent } from '../wasm';
import { TerrainsRes } from '../terrain/terrainPlugin';
import { BlendMode } from '../render/blend';
import { log } from '../util/logger';
import { bakesOf } from '../runtime/bakes';
import type { Entity } from '../types';
import { surfHeight, waveHeight, waveSlope, WAVE_SET_SIZE, type WaveParams } from './waves';
import { buildFarMesh, buildOceanMesh, oceanReach, oceanSnap } from './waterMesh';
import { installWaterfalls } from './waterfall';
import { type Point2 } from './shore';
import { Spline, type SplineData } from '../spline/splinePlugin';
import { SplineCurve } from '../spline/curve';
import { RippleField } from './ripples';
import {
    WaterField, WaterZone, currentShare, inExclusion, insideBody,
    type RiverStation, type ZoneBodyCommon, type ZoneExclusion, type WaterZoneData, type ZoneBody, type ZoneGrid, type ZoneGround,
} from './zone';
import { Quality } from '../render/qualityRuntime';
import { MOST_WATER_CAUSTIC_LAYERS, MOST_WATER_REFLECTION_STEPS } from '../render/qualitySettings/water';
import { waterReflectionGrowth } from './waterShader';
import { currentWeather, currentWeatherDrive, WeatherDrive } from '../postprocess/weather';
import { defaultQualityProfile, type QualityProfile } from '../render/quality';
import { isMiniGame } from '../platform';

/**
 * What a body of water is. A river follows the `Spline` on its own entity; an island is land, raised out of the water inside its outline; an
 * exclusion is a box kept out of the water, as dry inside as above it; a custom body is the shape of a mesh seen from above, its water at the
 * mesh's top.
 */
// Each kind's value as a plain constant, which the WaterBody definition names: a bundler drops a definition no one uses only when nothing in
// it could have an effect, and reading an object's property could (a getter), so one `WaterForm.Lake` in it kept the whole definition, all
// its tooltips, in every package with no water (check-lean-bundle).
const OCEAN = 0, LAKE = 1, RIVER = 2, ISLAND = 3, EXCLUSION = 4, CUSTOM = 5;
export const WaterForm = { Ocean: OCEAN, Lake: LAKE, River: RIVER, Island: ISLAND, Exclusion: EXCLUSION, Custom: CUSTOM } as const;

/** The fields of the `WaterBody` component. @experimental */
export interface WaterBodyData {
    /** {@link WaterForm}. */
    form: number;
    /** What the game calls the body, the same in every session (an entity's number is not): what a query names the water by. */
    bodyId: string;
    /** A lake's extent along x and z, centred on its entity, when it has no outline of its own. An ocean has none: it goes on past the zone. */
    sizeX: number;
    sizeZ: number;
    /** An exclusion's height, centred on its entity: water whose surface lies within it is kept out of its outline. */
    sizeY: number;
    /** A custom body's shape: the mesh whose triangles, seen from above, are its water, which stands at the mesh's top. Only a shape: nothing draws it. */
    shapeMesh: number;
    /** A lake's outline: three points or more round it on its own xz plane (x, y is x, z). Empty is the rectangle of `sizeX` by `sizeZ`. */
    boundary: Point2[];
    /** How far in from the shore, and how deep, the waves take to come to full height; 0 leaves them whole to the edge. */
    shoreWidth: number;
    /** A river's current, in world units a second where the river is as wide as its widest; a narrower reach runs faster. */
    flowSpeed: number;
    /** The height of the tallest wave, in world units. Their length, speed and heading are the zone's, which every body shares. */
    waveHeight: number;
    /** How deep a river cuts its bed into the terrain under its surface at its middle, or a lake its floor under its outline; 0 leaves the ground as it is. */
    bedDepth: number;
    /** {@link SurfaceLook}: whether the body's water is the zone material's colour or its own `waterColor`, blended into its neighbours where they meet. */
    surfaceLook: number;
    waterColor: { r: number; g: number; b: number; a: number };
    /** {@link UnderwaterLook}: whether seeing from under this body takes the zone material's look or its own, below. */
    underwaterLook: number;
    /** Its own look from under it: the colour the water gives back, what it takes out of the light colour by colour, how thick it is, and the web of sunlight on what is under it. */
    underwaterColor: { r: number; g: number; b: number; a: number };
    underwaterAbsorption: { r: number; g: number; b: number; a: number };
    underwaterDensity: number;
    underwaterCaustics: number;
    /** Whether the body changes the terrain at all: a lake's floor, a river's bed, an island. */
    affectsTerrain: boolean;
    /** {@link ChannelShape}: the built-in cut, or the Curve Channel below (an elevation curve over a ramp, laid as its blend says). */
    channelShape: number;
    elevationCurve: Curve;
    channelEdgeOffset: number;
    curveRampWidth: number;
    terrainBlend: number;
    falloffWidth: number;
    terrainZOffset: number;
    terraceAlpha: number;
    terraceSpacing: number;
    terraceSmoothness: number;
    /** {@link ChannelFalloff}: the bank given back over Falloff Width, or run out at Falloff Angle until it meets the ground. */
    falloffMode: number;
    falloffAngle: number;
    falloffEdgeOffset: number;
    blurRadius: number;
    curlAmount1: number;
    curlTiling1: number;
    curlAmount2: number;
    curlTiling2: number;
    innerSmoothDistance: number;
    outerSmoothDistance: number;
    terraceMaskLength: number;
    terraceMaskStartOffset: number;
    /** The depth under which the waves calm, shallower water calming them more; 0 calms them by no depth at all. */
    waveAttenuationDepth: number;
    /** Where this body's water overlaps another's, the higher priority gives the colour; equal ones blend. */
    overlapPriority: number;
    /** How far the water reaches past the outline, in world units. */
    shapeDilation: number;
    /** Whether the camera under this body's water sees the underwater look, its priority over another body's it is also under, how far round the body it blends in, and how much of it there is. */
    underwaterEnabled: boolean;
    underwaterPriority: number;
    underwaterBlendRadius: number;
    underwaterBlendWeight: number;
    /** An exclusion volume: whether it keeps out every body whose water overlaps it, or only those in `excludeBodies`. */
    excludeAllOverlapping: boolean;
    excludeBodies: number[];
}

/** How a lake or a river cuts the terrain: its built-in profile, or the Curve Channel its Terrain settings describe. */
const SHAPE_BUILT_IN = 0, SHAPE_CURVE = 1;
export const ChannelShape = { BuiltIn: SHAPE_BUILT_IN, Curve: SHAPE_CURVE } as const;

/** The elevation curve a Curve Channel starts with: an S from the curve's start (0) to the full depth (1). */
// The interpolation is written out, not read off InterpType: a read of another chunk's object is a statement a bundler must keep, and it
// would keep this component's whole definition in a package that has no water (check-lean-bundle).
const EASE_IN_OUT: InterpType = 'easeInOut';
const S_CURVE: Curve = { keys: [
    { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: EASE_IN_OUT },
    { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: EASE_IN_OUT },
] };

/** Where a body's surface colour comes from: the zone's water material, or the body's own Water Color. */
const SURFACE_ZONE = 0, SURFACE_OWN = 1;
export const SurfaceLook = { Zone: SURFACE_ZONE, Own: SURFACE_OWN } as const;

/** Where a body's underwater look comes from: the zone's water material, as the surface is drawn, or the body's own settings. */
const UNDER_ZONE = 0, UNDER_OWN = 1;
export const UnderwaterLook = { Zone: UNDER_ZONE, Own: UNDER_OWN } as const;

/**
 * A body of water. Presence is the opt-in; it is drawn as part of its zone's surface.
 *
 * @experimental
 */
export const WaterBody: ComponentDef<WaterBodyData> = /* @__PURE__ */ defineComponent<WaterBodyData>('WaterBody', {
    // Lengths at the engine's reference of 100 units a metre (ecs/worldUnits.ts): a 100 m lake with 30 cm waves in any project.
    form: LAKE, bodyId: '', sizeX: 10000, sizeZ: 10000, sizeY: 10000, shapeMesh: 0, boundary: [] as Point2[], shoreWidth: 300, flowSpeed: 200, waveHeight: 30, bedDepth: 0,
    surfaceLook: SURFACE_ZONE, waterColor: { r: 0.10, g: 0.42, b: 0.46, a: 1 },
    underwaterLook: UNDER_ZONE, underwaterColor: { r: 0.03, g: 0.2, b: 0.28, a: 1 }, underwaterAbsorption: { r: 0.45, g: 0.09, b: 0.05, a: 1 },
    underwaterDensity: 0.12, underwaterCaustics: 0.6,
    affectsTerrain: true, channelShape: SHAPE_BUILT_IN, elevationCurve: S_CURVE, channelEdgeOffset: 0, curveRampWidth: 1500,
    terrainBlend: BLEND_ALPHA, falloffWidth: 300, terrainZOffset: 0, terraceAlpha: 0, terraceSpacing: 100, terraceSmoothness: 0,
    falloffMode: FALLOFF_WIDTH, falloffAngle: 45, falloffEdgeOffset: 0, blurRadius: 0, curlAmount1: 0, curlTiling1: 2000, curlAmount2: 0,
    curlTiling2: 500, innerSmoothDistance: 0, outerSmoothDistance: 0, terraceMaskLength: 0, terraceMaskStartOffset: 0,
    waveAttenuationDepth: 300, overlapPriority: 0, shapeDilation: 0,
    underwaterEnabled: true, underwaterPriority: 0, underwaterBlendRadius: 0, underwaterBlendWeight: 1,
    excludeAllOverlapping: true, excludeBodies: [] as number[],
}, {
    worldUnitFields: ['sizeX', 'sizeZ', 'sizeY', 'shoreWidth', 'flowSpeed', 'waveHeight', 'bedDepth', 'channelEdgeOffset', 'curveRampWidth', 'falloffWidth', 'terrainZOffset', 'terraceSpacing', 'falloffEdgeOffset', 'blurRadius', 'curlAmount1', 'curlTiling1', 'curlAmount2', 'curlTiling2', 'innerSmoothDistance', 'outerSmoothDistance', 'terraceMaskLength', 'terraceMaskStartOffset', 'waveAttenuationDepth', 'shapeDilation', 'underwaterBlendRadius'],
    assetFields: [{ field: 'shapeMesh', type: 'mesh' }],
    entityFields: ['excludeBodies'],
    fields: {
        form: { enum: [{ label: 'Ocean', value: OCEAN }, { label: 'Lake', value: LAKE }, { label: 'River', value: RIVER }, { label: 'Island', value: ISLAND }, { label: 'Exclusion Volume', value: EXCLUSION }, { label: 'Custom', value: CUSTOM }], category: 'Shape', tooltip: 'An ocean is without edge: everywhere at its height where the ground is lower; a lake is a rectangle or an outline of its own; a river follows the Spline on the same entity; an island raises the terrain inside its rectangle or outline to its own height, out of the water round it; an exclusion volume keeps the water out of a box (a dry room under the sea, the hold of a boat): the surface is not drawn over it, and inside it nothing is under water; a custom body is the shape of its Shape Mesh seen from above (a fountain bowl, a pool of any outline), its water at the mesh’s top.' },
        bodyId: { category: 'Shape', tooltip: 'What the game calls this body, the same in every session: what a query names the water by. Empty is named by its entity.' },
        sizeX: { min: 1, category: 'Shape', tooltip: 'The size of a lake or an island along x.', shownWhen: { field: 'form', values: [LAKE, ISLAND, EXCLUSION] } },
        sizeZ: { min: 1, category: 'Shape', tooltip: 'The size of a lake or an island along z.', shownWhen: { field: 'form', values: [LAKE, ISLAND, EXCLUSION] } },
        shapeMesh: { category: 'Shape', tooltip: 'The mesh a custom body is the shape of: its triangles seen from above are the water, and the water stands at its top. Only a shape; nothing draws it.', shownWhen: { field: 'form', values: [CUSTOM] } },
        sizeY: { min: 0.01, category: 'Shape', tooltip: 'The height of the exclusion volume, centred on its entity. Water whose surface lies within it is kept out of its outline; a point inside it is not in water.', shownWhen: { field: 'form', values: [EXCLUSION] } },
        excludeAllOverlapping: { label: 'Exclude All Overlapping Water Bodies', category: 'Water', tooltip: 'Keeps every body whose water overlaps this volume out of it: none drawn inside it, and a point inside it is in no water, so a base or a tunnel under the sea is dry. Off, it keeps out only the bodies listed below.', shownWhen: { field: 'form', values: [EXCLUSION] } },
        excludeBodies: { label: 'Water Bodies to Exclude', category: 'Water', tooltip: 'The bodies this volume keeps out when it does not keep out all of them: inside it their water is not drawn and a point is in none of it, while any other body runs on through.', shownWhen: { field: 'excludeAllOverlapping', values: [0] } },
        boundary: { category: 'Shape', tooltip: 'The outline of a lake or an island: points round it on its own xz plane. Empty is the rectangle of its size.', shownWhen: { field: 'form', values: [LAKE, ISLAND, EXCLUSION] } },
        shoreWidth: { min: 0, category: 'Shape', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, ISLAND, CUSTOM] }, tooltip: 'How far in from the shore, and how deep, the waves take to come to full height. 0 leaves them whole to the edge. On an island, how far out past its outline its slope runs down to the ground.' },
        flowSpeed: { min: 0, max: 5000, category: 'Waves', tooltip: 'A river\'s current, in world units a second where it is as wide as its widest. A narrower reach runs faster.', shownWhen: { field: 'form', values: [RIVER] } },
        bedDepth: { min: 0, category: 'Shape', tooltip: 'How deep the water cuts into the terrain under its surface: a river its bed at its middle, its banks blending back into the ground; a lake its floor under its outline, sloping down from the shore. Only cuts; 0 leaves the ground as it is.', shownWhen: { field: 'form', values: [RIVER, LAKE] } },
        surfaceLook: { enum: [{ label: 'Zone Material', value: SURFACE_ZONE }, { label: 'Own', value: SURFACE_OWN }], category: 'Look', tooltip: 'The colour of this body\u2019s water: the zone water material\u2019s, or its own Water Color. Where a body with its own colour meets another (a river running into a lake), the two colours run into each other across the junction.', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
        waterColor: { category: 'Look', tooltip: 'The colour of this body\u2019s shallow water. Deep water darkens it the way the zone material\u2019s deep colour darkens its shallow one.', shownWhen: { field: 'surfaceLook', values: [SURFACE_OWN] } },
        underwaterLook: { enum: [{ label: 'Zone Material', value: UNDER_ZONE }, { label: 'Own', value: UNDER_OWN }], category: 'Underwater', tooltip: 'What the world looks like from under this body: the look of the zone water material, as its surface is drawn, or the settings below, so a murky pond and a clear sea in one zone each look their own from inside.', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
        underwaterColor: { category: 'Underwater', tooltip: 'The colour the water gives back from under it, deepening with the depth of the camera.', shownWhen: { field: 'underwaterLook', values: [UNDER_OWN] } },
        underwaterAbsorption: { category: 'Underwater', tooltip: 'What the water takes out of the light, colour by colour, as it crosses it: red first in clear sea water.', shownWhen: { field: 'underwaterLook', values: [UNDER_OWN] } },
        underwaterDensity: { min: 0, max: 4, category: 'Underwater', tooltip: 'How thick the water is: how soon what is seen through it fades into its colour.', shownWhen: { field: 'underwaterLook', values: [UNDER_OWN] } },
        affectsTerrain: { category: 'Terrain', tooltip: 'Whether this body changes the terrain under and round it: a lake cutting its floor, a river its bed, an island raising its ground. Off, the terrain is left as it is and the water lies over it.', shownWhen: { field: 'form', values: [LAKE, RIVER, ISLAND] } },
        channelShape: { enum: [{ label: 'Built In', value: SHAPE_BUILT_IN }, { label: 'Curve Channel', value: SHAPE_CURVE }], category: 'Terrain', tooltip: 'How the bed is cut: the built-in profile (a lake\u2019s floor sloping in from its shore, a river\u2019s rounded trough), or the Curve Channel below: an elevation curve across a ramp from the shore, laid over the ground as its blend mode says, with terraces if asked.', shownWhen: { field: 'form', values: [LAKE, RIVER] } },
        elevationCurve: { curve: true, category: 'Terrain', tooltip: 'The bed\u2019s profile across the ramp: from the curve\u2019s start (0, at the shore plus the edge offset) to the end of the ramp (1), how much of the full depth it is cut to. Keep its end at 1 so the depth set on the body (or on a river\u2019s points) is the depth reached.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        channelEdgeOffset: { category: 'Terrain', tooltip: 'How far in from the shore the curve starts, in world units. Negative starts it out on the bank, which widens the cut past the water.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        curveRampWidth: { min: 0.01, category: 'Terrain', tooltip: 'How wide the curve ramps from its start to the full depth, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terrainBlend: { enum: [{ label: 'Min', value: BLEND_MIN }, { label: 'Max', value: BLEND_MAX }, { label: 'Alpha Blend', value: BLEND_ALPHA }, { label: 'Additive', value: BLEND_ADDITIVE }], category: 'Terrain', tooltip: 'How the channel is laid over the terrain. Alpha Blend lays the profile either way, cutting ground that is higher and raising ground that is lower, so the water always has ground at its level: what most bodies want. Min only cuts (ground already lower stays): for a river running into a lake, so it does not raise the lake’s floor. Max only raises. Additive adds onto the ground the cut a flat ground at the water’s level would get, keeping the ground’s own detail and slope, but not placing the bed at exact heights.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        falloffWidth: { min: 0, category: 'Terrain', tooltip: 'Width falloff: past the flat edge, how far out the bank runs back into the terrain, in world units. Angle falloff: the farthest the bank runs out looking for the ground.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        falloffMode: { enum: [{ label: 'Width', value: FALLOFF_WIDTH }, { label: 'Angle', value: FALLOFF_ANGLE }], category: 'Terrain', tooltip: 'How the bank meets the ground round the water. Width gives it back over Falloff Width whether or not it met the ground. Angle runs it out at Falloff Angle until it meets the ground, cutting into a hill or building up from a hollow, Falloff Width the farthest it goes.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        falloffAngle: { min: 1, max: 89, unit: '°', category: 'Terrain', tooltip: 'Angle falloff: the slope of the bank, in degrees from level.', shownWhen: { field: 'falloffMode', values: [FALLOFF_ANGLE] } },
        falloffEdgeOffset: { min: 0, category: 'Terrain', tooltip: 'A flat edge round the water at its level before the falloff starts, in world units: a level bank along a river even where it cuts through a hill.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terrainZOffset: { category: 'Terrain', tooltip: 'Raises (or, negative, lowers) the whole cut against the water\u2019s surface, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terraceAlpha: { min: 0, max: 1, category: 'Terrain', tooltip: 'Terraces laid over the cut: 0 none, 1 fully stepped.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terraceSpacing: { min: 0.01, category: 'Terrain', tooltip: 'The rise of each terrace, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terraceSmoothness: { min: 0, max: 1, category: 'Terrain', tooltip: 'How round the terraces\u2019 edges are: 0 sheer steps, 0.5 rounded, 1 no steps at all.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terraceMaskLength: { min: 0, category: 'Terrain', tooltip: 'Terraces only within this span of distance out from the water’s edge, in world units; 0 for terraces everywhere the body reaches.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        terraceMaskStartOffset: { min: 0, category: 'Terrain', tooltip: 'How far out from the water’s edge the terraces’ span starts, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        blurRadius: { min: 0, category: 'Terrain', tooltip: 'Averages the cut over this radius, in world units, softening its edges and corners all round. 0 for none: the outline’s distance is exact, so it needs no blur to hide steps.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        curlAmount1: { min: 0, category: 'Terrain', tooltip: 'Curl noise bending the cut’s outline, first octave: how far it moves the edge, in world units. 0 for none.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        curlTiling1: { min: 0.01, category: 'Terrain', tooltip: 'The size of the first octave’s swirls, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        curlAmount2: { min: 0, category: 'Terrain', tooltip: 'Curl noise, second octave: how far it moves the edge, in world units. 0 for none.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        curlTiling2: { min: 0.01, category: 'Terrain', tooltip: 'The size of the second octave’s swirls, in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        innerSmoothDistance: { min: 0, category: 'Terrain', tooltip: 'Rounds the inner edge, where the bed leaves the bank, over this width in world units: an easier way in and out of the water.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        outerSmoothDistance: { min: 0, category: 'Terrain', tooltip: 'Rounds the outer edge, where the bank meets the ground, over this height in world units.', shownWhen: { field: 'channelShape', values: [SHAPE_CURVE] } },
        underwaterEnabled: { category: 'Underwater', tooltip: 'Whether the camera under this body\u2019s water sees it as under water at all. Off for water a game never goes under: no underwater look is worked out for it.', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
        underwaterPriority: { min: -8192, max: 8191, step: 1, category: 'Underwater', tooltip: 'Where the camera is under two bodies at once (a lake in a sea, a river running into it), the higher priority\u2019s underwater look is laid over the lower one\u2019s, by its Blend Weight. Equal ones are laid in no set order.', shownWhen: { field: 'underwaterEnabled', values: [1] } },
        underwaterBlendRadius: { min: 0, category: 'Underwater', tooltip: 'How far out past the body\u2019s outline its underwater look fades in, in world units: swimming from one body into another blends their looks across this.', shownWhen: { field: 'underwaterEnabled', values: [1] } },
        underwaterBlendWeight: { min: 0, max: 1, category: 'Underwater', tooltip: 'How much of this body\u2019s underwater look there is: 1 all of it, 0 none.', shownWhen: { field: 'underwaterEnabled', values: [1] } },
        underwaterCaustics: { min: 0, max: 4, category: 'Underwater', tooltip: 'How bright the web of sunlight through the waves is on what is under the water. 0 draws none.', shownWhen: { field: 'underwaterLook', values: [UNDER_OWN] } },
        waveAttenuationDepth: { min: 0, category: 'Waves', tooltip: 'How shallow the water must be for its waves to start calming, in world units: the shallower it is, the more they calm, flat at the water\u2019s edge. 0 calms them by no depth (the Shore Width still calms them toward the shore).', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
        overlapPriority: { min: -8192, max: 8191, step: 1, category: 'Look', tooltip: 'Where this body\u2019s water overlaps another\u2019s, the higher priority gives the water its colour, blending only across its own edge. Equal priorities blend their colours by how far inside each the water is, the way a river runs into its lake.', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
        shapeDilation: { min: 0, category: 'Shape', tooltip: 'How far the water reaches past its outline, in world units. The zone draws water from a field of texels: a body narrower than a few of them (a stream, a small pond) can come out thin or broken, and growing it holds it.', shownWhen: { field: 'form', values: [LAKE, RIVER, CUSTOM] } },
        waveHeight: { min: 0, max: 800, category: 'Waves', tooltip: 'The height of the tallest wave, in world units. Their length, speed and heading are the zone\'s.', shownWhen: { field: 'form', values: [OCEAN, LAKE, RIVER, CUSTOM] } },
    },
});

/** What {@link Waters.sample} answers. */
export interface WaterSample {
    /** The entity of the body that holds the most of the water there, and what the game calls it (its `bodyId`). */
    entity: Entity;
    bodyId: string;
    /** How far the point is above the surface (negative under it), in world units. */
    depth: number;
    /** The surface's normal at the point, in world space. */
    normal: [number, number, number];
    /** How the water moves there, in world units a second (a river's current; still water is zero). */
    flow: [number, number, number];
    /** The world position of the surface above or below the point. */
    surface: [number, number, number];
    /** How loud the water sounds there, for what plays its sound: a river's audio intensity along its spline (its points' Audio Intensity), 1 for still water. */
    audioIntensity: number;
    /**
     * How deep the water is there: from its surface at rest down to the ground under it (a river's bed, a lake's floor), in world units. What wading, swimming
     * and a boat running aground are decided by. Open sea with no ground known under it, and sea past the zone, answer 1e6.
     */
    waterDepth: number;
    /** Whether the point is over water: always, for an answer that is not null. */
    inside: boolean;
}

/** What the quality level lets water spend: waves summed, the ripple grid's side, whether waves lift the geometry, the mirror from below, the sun's light through it. */
export interface WaterQuality {
    waves: number;
    rippleCells: number;
    displacement: boolean;
    mirror: boolean;
    caustics: boolean;
    reflectionSteps: number;
    causticLayers: number;
}

/** Everything on: a project with no quality policy, off a minigame. */
export const FULL_WATER: WaterQuality = {
    waves: WAVE_SET_SIZE, rippleCells: 256, displacement: true, mirror: true, caustics: true,
    reflectionSteps: MOST_WATER_REFLECTION_STEPS, causticLayers: MOST_WATER_CAUSTIC_LAYERS,
};

/**
 * What water is allowed: the active quality profile when the project has a quality policy running; else the low profile on a minigame, which has the least to spend and
 * gets the lite water (flat geometry, no mirror, no web of light) without anyone asking; else everything.
 */
export function waterQualityOf(profile: Readonly<QualityProfile> | null, miniGame: boolean): WaterQuality {
    const p = profile ?? (miniGame ? defaultQualityProfile('low') : null);
    if (!p) return FULL_WATER;
    return {
        waves: p.waterWaves, rippleCells: p.waterRippleCells, displacement: p.waterDisplacement, mirror: p.waterMirror, caustics: p.waterCaustics,
        reflectionSteps: p.waterReflectionSteps, causticLayers: p.waterCausticLayers,
    };
}

/** The zone a scene without a `WaterZone` is given: the component's defaults, over every lake and river. */
/** The zone's defaults in the project's units: asked each time, since a project says what a unit is before its scene loads. */
const zoneDefaults = (): WaterZoneData => ({ ...WaterZone._default });

/** Run-time access to the water: where its surface is at a point, for what floats on it or swims in it. */
export class Waters {
    /** @internal */ app_: App | null = null;
    /** What the quality level allows now; the plugin refreshes it each frame, and what is drawn and what is answered both follow it. */
    quality: WaterQuality = FULL_WATER;
    /** The baked water, and the zone it was baked by. @internal */
    field_: WaterField | null = null;
    /** @internal */ zone_: WaterZoneData = zoneDefaults();
    /** The places kept out of the water, as the scene says now. @internal */
    exclusions_: readonly ZoneExclusion[] = [];
    /** The zone entity's world height, for the far distance mesh of a zone with no ocean. @internal */
    zoneLevel_ = 0;
    /** @internal */ influences_ = new Map<number, { islands: number[]; exclusions: number[] }>();
    /** @internal The bodies the zone was last baked from, as it took them. */ bodies_: readonly ZoneBody[] = [];

    /**
     * The bodies whose outline a world point (x, z) is inside or within `reach` of, with how far inside it is (negative outside) and the
     * height of their surface there: an ocean has every point.
     */
    bodiesAt(x: number, z: number, reach: (entity: Entity) => number = () => 0): Array<{ entity: Entity; inside: number; level: number }> {
        const out: Array<{ entity: Entity; inside: number; level: number }> = [];
        for (const body of this.bodies_) {
            const at = insideBody(body, x, z);
            if (at && at.inside >= -Math.max(reach(body.key as Entity), 0)) out.push({ entity: body.key as Entity, ...at });
        }
        return out;
    }
    /** @internal */ zoneEntity_: number | null = null;

    /**
     * The islands and exclusion volumes that act on a body of water (those whose ground overlaps it; an ocean, which goes on without edge,
     * has every one in its zone), and the zone it belongs to: the WaterZone entity, or null where it is drawn by the zone made for a scene
     * without one.
     */
    influencesOf(entity: Entity): { islands: Entity[]; exclusions: Entity[]; zone: Entity | null } {
        const got = this.influences_.get(entity as number);
        return { islands: (got?.islands ?? []) as Entity[], exclusions: (got?.exclusions ?? []) as Entity[], zone: this.zoneEntity_ as Entity | null };
    }
    /** The ripples the zone keeps, where it asks for them. @internal */
    ripples_: RippleField | null = null;
    /** The material instance the surface is drawn with, for what draws the same water (the underwater effect). @internal */
    instance_ = 0;
    /** Bumped each time a new bake lands, so what is placed by the water (plants kept out of it) knows to place again. @internal */
    revision_ = 0;
    /** Whether a bake is in hand: what is placed by the water waits for it. */
    baking = false;

    /** The baked water as data a worker can answer `depthAt` and `shoreAt` from, or null where none is baked. */
    queryData(): WaterQueryData | null {
        return this.field_?.query().data ?? null;
    }

    /**
     * Whether there is no water to ask about: nothing is baked, so `depthAt` answers null everywhere. A world laid out with no water at
     * all is laid out the same here and on a worker, which "no data to hand over" alone does not say.
     */
    get empty(): boolean {
        return this.field_ === null;
    }

    /** How deep the water stands at rest over the world height `y` at (x, z): above zero under water, null where there is none. */
    depthAt(x: number, z: number, y: number): number | null {
        return this.field_?.query().depthAt(x, z, y) ?? null;
    }

    /**
     * The surface over or under `(x, y, z)`: how far above it the point is (negative under), the surface's normal, the current, and the point
     * on it straight above or below. Null where there is no water. The waves are read at the instant of the frame.
     */
    sample(x: number, y: number, z: number): WaterSample | null {
        const field = this.field_;
        if (!field || !this.app_) return null;
        // Inside a place kept out of the water nothing is under it, though the sea's surface stands above.
        const s = field.sample(x, z);
        if (!s) return null;
        for (const e of this.exclusions_) if (inExclusion(e, x, y, z, s.key)) return null;
        const time = this.app_.getResource(Time).elapsed;
        const params = this.waves(s.amp, s.exposure);
        const zone = this.zone_;
        const still = s.still;
        // Surf is swell come in from open water: sheltered water has as little of it as it is sheltered.
        const surf = surfHeight(s.shore, zone.surf * grown(s.exposure) * s.swell * s.exposure * still, zone.surfLength, zone.waveSpeed, time, s.surf);
        // The lite water is flat: its waves are in the shading, so the height code reads is the rest plane's.
        const h = s.height + (this.quality.displacement ? waveHeight(params, x, z, time) + surf : 0) + (this.ripples_?.heightAt(x, z) ?? 0);
        const [sx, sz] = waveSlope(params, x, z, time);
        const len = Math.hypot(sx, 1, sz);
        return {
            entity: s.key as Entity, bodyId: this.bodyIdOf(s.key as Entity), depth: y - h, normal: [-sx / len, 1 / len, -sz / len], flow: [s.flowX, 0, s.flowZ], surface: [x, h, z],
            waterDepth: s.depth, audioIntensity: s.audio, inside: true,
        };
    }

    /**
     * Disturbs the water at the world point (x, y, z): a bump of `strength` world units (negative is a dip) over `radius`, which spreads as a ring and leaves foam.
     * Does nothing where there is no water or where the zone keeps no ripples.
     */
    disturb(x: number, y: number, z: number, radius: number, strength: number): boolean {
        void y;
        if (!this.ripples_ || !this.field_?.sample(x, z)) return false;
        this.ripples_.disturb(x, z, radius, strength);
        return true;
    }

    /** The height the ripples add to the surface at the world point, where the zone keeps them; 0 elsewhere. */
    rippleAt(x: number, _y: number, z: number): number {
        return this.ripples_?.heightAt(x, z) ?? 0;
    }

    /**
     * The body of water at (x, z) and its surface at rest, or null where there is none: which water a place belongs to, for what a game
     * keeps per body (a fishing spot, a level it raises) and a placement that keeps by the shore.
     */
    bodyAt(x: number, z: number): { entity: Entity; bodyId: string; form: number; level: number } | null {
        const s = this.field_?.sample(x, z);
        const world = this.app_?.world;
        if (!s || !world || s.key < 0) return null;
        const entity = s.key as Entity;
        const body = world.valid(entity) && world.has(entity, WaterBody) ? world.get(entity, WaterBody) as WaterBodyData : null;
        return { entity, bodyId: body?.bodyId || `entity:${entity}`, form: body?.form ?? WaterForm.Ocean, level: s.height };
    }

    /**
     * How far (x, z) is from the water's edge, across the ground: above zero on dry land (how far to the nearest water), below it on the
     * water (how far in from its shore). Past the zone's region it is the open sea's, deep in; null where no water is baked at all.
     */
    shoreAt(x: number, z: number): number | null {
        return this.field_?.query().shoreAt(x, z) ?? null;
    }

    private bodyIdOf(entity: Entity): string {
        const world = this.app_?.world;
        const body = world?.valid(entity) && world.has(entity, WaterBody) ? world.get(entity, WaterBody) as WaterBodyData : null;
        return body?.bodyId || `entity:${entity}`;
    }

    /** The world height of the surface above or below (x, z), or null where there is none. */
    heightAt(x: number, z: number): number | null {
        return this.sample(x, 0, z)?.surface[1] ?? null;
    }

    /** The waves as they stand where the zone says they are `amp` high: the zone's, at that height, raised by the weather as far as the water is open to it. */
    private waves(amp: number, exposure = 1): WaveParams {
        return { ...waveParamsOf(this.zone_), height: amp * grown(exposure), count: this.quality.waves };
    }
}

/** The resource the plugin installs. @experimental */
export const WatersRes = /* @__PURE__ */ defineResource<Waters>(/* @__PURE__ */ new Waters(), 'Waters');

/** The outline of a lake: its own boundary when it has three points or more, else the rectangle of its size. */
function outlineOf(d: WaterBodyData): Point2[] {
    if (d.boundary.length >= 3) return d.boundary.map((p) => ({ x: p.x, y: p.y }));
    const hx = d.sizeX / 2, hz = d.sizeZ / 2;
    return [{ x: -hx, y: -hz }, { x: hx, y: -hz }, { x: hx, y: hz }, { x: -hx, y: hz }];
}

/** × the waves' height the weather asks for now: 1 with no weather, or one that does not drive the wind. */
function weatherWaves(): number {
    const w = currentWeather();
    return w && (currentWeatherDrive() & WeatherDrive.Wind) ? w.waves : 1;
}

/** How far the weather raises the waves of water `exposure` open to the wind: all the way on open sea, little on a sheltered pond. */
/** @internal */
export function grown(exposure: number): number {
    return 1 + (weatherWaves() - 1) * Math.min(Math.max(exposure, 0), 1);
}

/**
 * How open a body is to the wind, 0 to 1: wind waves grow with the water they blow over (their fetch), so the weather raises them fully
 * on the sea and the more on a lake the wider it is, against eight of the zone's wave lengths; a river's fetch is its width.
 */
/** @internal */
export function exposureOf(body: ZoneBody, waveLength: number): number {
    if (body.kind === 'ocean') return 1;
    let fetch: number;
    if (body.kind === 'lake') {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const p of body.outline) {
            const [x, z] = body.toWorld(p.x, p.y);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
        fetch = Math.min(maxX - minX, maxZ - minZ);
    } else {
        fetch = body.stations.reduce((n, s) => n + s.half * 2, 0) / Math.max(body.stations.length, 1);
    }
    return Math.min(Math.max(fetch / Math.max(waveLength * 8, 1e-6), 0.1), 1);
}

/** How hard it rains on the water now (the weather's rain level), 0 with none or one that does not drive the rain. */
function weatherRain(): number {
    const w = currentWeather();
    return w && (currentWeatherDrive() & WeatherDrive.Rain) ? w.rain : 0;
}

/** The zone's waves at unit height, scaled by the weather: what is drawn and what the surface answers both read this, times each place's height. */
export function waveParamsOf(zone: Pick<WaterZoneData, 'waveLength' | 'waveSpeed' | 'waveDirection'>): WaveParams {
    return { height: weatherWaves(), length: zone.waveLength, speed: zone.waveSpeed, direction: zone.waveDirection };
}

/**
 * How hard it rains on the water: the weather's rain, which the Water shader rings out as drops on the surface (`u_rain`). Rain is
 * drawn, not simulated: it puts nothing in the ripples a zone keeps, and no foam.
 */
export function rainOnWater(): number {
    return weatherRain();
}

type Quat = { x: number; y: number; z: number; w: number };

/** `v` turned by `q`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (q.y * vz - q.z * vy), ty = 2 * (q.z * vx - q.x * vz), tz = 2 * (q.x * vy - q.y * vx);
    return [vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx)];
}

/** What every body tells the zone beside its shape: its waves' calming depth, how far its water is grown out, and its colour's priority. */
function commonOf(d: WaterBodyData, scale: number): ZoneBodyCommon {
    return { attenuationDepth: (d.waveAttenuationDepth ?? d.shoreWidth) * scale, dilation: (d.shapeDilation ?? 0) * scale, priority: d.overlapPriority ?? 0 };
}

/** What the zone is baked from of {@link commonOf}, for knowing when to bake it again. */
function commonKey(d: WaterBodyData): unknown[] {
    return [d.waveAttenuationDepth, d.shapeDilation, d.overlapPriority];
}

/** A lake's or a river's Curve Channel, in world units, or null where it keeps the built-in cut. */
function channelOf(d: WaterBodyData, scale: number): ChannelSettings | null {
    if (d.channelShape !== ChannelShape.Curve) return null;
    const keys = d.elevationCurve?.keys ?? [];
    return {
        curve: keys.length > 0 ? (u) => sampleKeyframes(keys, u) : (u) => u * u * (3 - 2 * u),
        edgeOffset: d.channelEdgeOffset * scale, ramp: d.curveRampWidth * scale, blend: d.terrainBlend, falloff: d.falloffWidth * scale,
        zOffset: d.terrainZOffset * scale, terraceAlpha: d.terraceAlpha, terraceSpacing: d.terraceSpacing * scale, terraceSmoothness: d.terraceSmoothness,
        falloffMode: d.falloffMode, falloffAngle: d.falloffAngle, bankEdge: d.falloffEdgeOffset * scale, blurRadius: d.blurRadius * scale,
        curlAmount1: d.curlAmount1 * scale, curlTiling1: d.curlTiling1 * scale, curlAmount2: d.curlAmount2 * scale, curlTiling2: d.curlTiling2 * scale,
        innerSmooth: d.innerSmoothDistance * scale, outerSmooth: d.outerSmoothDistance * scale,
        terraceMaskLength: d.terraceMaskLength * scale, terraceMaskStart: d.terraceMaskStartOffset * scale,
    };
}

/** What a Curve Channel is cut from, for knowing when to cut it again. */
function channelKey(d: WaterBodyData): unknown[] {
    return [d.elevationCurve, d.channelEdgeOffset, d.curveRampWidth, d.terrainBlend, d.falloffWidth, d.terrainZOffset, d.terraceAlpha, d.terraceSpacing, d.terraceSmoothness,
        d.falloffMode, d.falloffAngle, d.falloffEdgeOffset, d.blurRadius, d.curlAmount1, d.curlTiling1, d.curlAmount2, d.curlTiling2, d.innerSmoothDistance,
        d.outerSmoothDistance, d.terraceMaskLength, d.terraceMaskStartOffset];
}

/** A body's outline with the way into and out of its plane, for what it does to the ground. */
function outlineSpace(t: TransformData, outline: readonly Point2[], scale: number): OutlineSpace {
    return {
        outline, scale,
        toLocal: (x, z) => { const q = toLocal(t, x, t.worldPosition.y, z, scale); return [q[0], q[2]]; },
        toWorld: (x, z) => { const w = fromLocal(t, x, 0, z, scale); return [w[0], w[2]]; },
    };
}

function toLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const inv = { x: -t.worldRotation.x, y: -t.worldRotation.y, z: -t.worldRotation.z, w: t.worldRotation.w };
    const r = rotate(inv, x - t.worldPosition.x, y - t.worldPosition.y, z - t.worldPosition.z);
    return [r[0] / scale, r[1] / scale, r[2] / scale];
}

function fromLocal(t: TransformData, x: number, y: number, z: number, scale: number): [number, number, number] {
    const r = rotate(t.worldRotation, x * scale, y * scale, z * scale);
    return [r[0] + t.worldPosition.x, r[1] + t.worldPosition.y, r[2] + t.worldPosition.z];
}

/** A river's stations in the world: a few to its narrowest width along its curve, each with its height, half its width, its heading and its current. */
export function riverStations(curve: SplineCurve, flowSpeed: number, toWorld: (x: number, y: number, z: number) => [number, number, number],
    turn: (x: number, y: number, z: number) => [number, number, number], scale: number): RiverStation[] {
    let widest = 0, narrowest = Infinity;
    for (let i = 0; i <= 64; i++) {
        const w = curve.width((i / 64) * curve.length);
        widest = Math.max(widest, w);
        narrowest = Math.min(narrowest, w);
    }
    const step = Math.max(narrowest / 3, curve.length / 1024, 1e-3);
    const count = Math.max(2, Math.ceil(curve.length / step) + 1);
    const stations: RiverStation[] = [];
    for (let i = 0; i < count; i++) {
        const s = (i / (count - 1)) * curve.length;
        const [px, py, pz] = curve.position(s);
        const [x, y, z] = toWorld(px, py, pz);
        const tangent = curve.tangent(s);
        const [tx, , tz] = turn(tangent[0], 0, tangent[2]);
        const run = Math.hypot(tx, tz) || 1;
        const width = curve.width(s);
        // A velocity the spline's points carry is the current there, and runs back toward the start where it is negative; without one, the
        // river's flowSpeed, quicker where it narrows.
        const velocity = curve.value('velocity', s), depth = curve.value('depth', s), audio = curve.value('audioIntensity', s);
        stations.push({
            x, y, z, half: (width / 2) * scale, dx: tx / run, dz: tz / run,
            speed: velocity !== null ? velocity * scale : flowSpeed * currentShare(width, widest) * 2 * scale,
            ...(depth !== null ? { depth: depth * scale } : {}), ...(audio !== null ? { audio } : {}),
        });
    }
    return stations;
}

/** A river whose bed is cut into the terrain. */
/** What one body does to the ground under it: a river's bed, a lake's floor, an island; laid again only when its signature changes. */
interface Bed { key: number; signature: string; make(prefix: string): TerrainModifier[] }

/** Everything the zone is baked from, as the scene says it now. */
interface Inputs {
    beds: Bed[];
    exclusions: ZoneExclusion[];
    /** The world height of the zone's entity (0 without one): where the far distance mesh lies when the zone has no ocean to lay it at. */
    zoneLevel: number;
    /** Each body's islands and exclusion volumes (those whose ground overlaps it), and the zone entity it belongs to (null for the implicit zone). */
    influences: Map<number, { islands: number[]; exclusions: number[] }>;
    zoneEntity: number | null;
    bodies: ZoneBody[];
    grid: ZoneGrid;
    zone: WaterZoneData;
    /** What, changed, rebakes the field. */
    key: string;
}

/** The surface the plugin draws: its mesh, its material instance and the textures it reads the field and the ripples from. */
interface Surface {
    entity: Entity;
    mesh: number;
    meshKey: string;
    instance: number;
    /** The far distance mesh past the rings, and the instance of its own material when the zone names one (0: it is drawn with `instance`). */
    farEntity: Entity;
    farMesh: number;
    farInstance: number;
    material: number;
    heights: number;
    field: number;
    exposure: number;
    /** The bodies' own colours, blended where they meet (see WaterField.look). */
    look: number;
    /** Which bake the textures hold. */
    baked: WaterField | null;
    ripple: number;
    rippleBytes: Uint8Array | null;
    epoch: number;
    pending: boolean;
    /** Why the surface could not be made, once it could not: it is asked for again only when its mesh or material changes. */
    failure: string | null;
}

export class WaterPlugin implements Plugin {
    name = 'water';
    /** Nothing to bake, carve or draw without a body or a zone; the frame after the last one goes still runs, and lets go. */
    readonly activeWhen = [WaterBody, WaterZone];

    /** The stock material the surface is an instance of when the zone names none, made once from the Water shader. */
    private stock_ = 0;
    /** The resource this plugin installed. */
    private waters_: Waters = new Waters();
    private key_ = '';
    private surface_: Surface | null = null;
    private epoch_ = 0;
    /** The bake in hand, for the inputs `key` names; the field drawn until it lands is the last one baked. */
    private baking_: { key: string; cancel: () => void } | null = null;
    /** The beds cut into the terrain, by river: what they were cut from, and the ids of their modifiers. */
    private beds_ = new Map<number, { signature: string; ids: string[] }>();
    /** Custom bodies' shapes, by mesh handle: read once, the geometry being asked for the first time it is named (null: it has no shape to give). */
    private footprints_ = new Map<number, Footprint | null | 'reading'>();

    build(app: App): void {
        const waters = new Waters();
        this.waters_ = waters;
        waters.app_ = app;
        app.insertResource(WatersRes, waters);
        installWaterfalls(app);

        app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
            const policy = app.hasResource(Quality) ? app.getResource(Quality) : null;
            waters.quality = waterQualityOf(policy && policy.enabled ? policy.profile : null, isMiniGame());
            // What the water IS (the baked field) needs no renderer: it is baked here whether or not anything is drawn, so a server or a test
            // that never draws can still ask the surface where it is. What is DRAWN waits for the asset layer.
            const inputs = this.gather(app);
            this.carve(app, inputs.beds);
            waters.zone_ = inputs.zone;
            waters.exclusions_ = inputs.exclusions;
            waters.zoneLevel_ = inputs.zoneLevel;
            waters.influences_ = inputs.influences;
            waters.bodies_ = inputs.bodies;
            waters.zoneEntity_ = inputs.zoneEntity;
            if (inputs.bodies.length === 0) {
                this.baking_?.cancel();
                this.baking_ = null;
                waters.baking = false;
                waters.field_ = null;
                this.key_ = '';
                this.dropRipples();
                this.dropSurface(app);
                return;
            }
            if (inputs.key !== this.key_ && this.baking_?.key !== inputs.key) {
                // A big zone is a second or more of work: it is spread over frames and shown while it runs.
                this.baking_?.cancel();
                const key = inputs.key;
                const job = bakesOf(app).run('Baking the water', WaterField.baking(inputs.grid, inputs.bodies, this.ground(app), inputs.zone.surfLength, inputs.exclusions));
                this.baking_ = { key, cancel: job.cancel };
                waters.baking = true;
                void job.done.then((field) => {
                    if (this.baking_?.key !== key) return;
                    this.baking_ = null;
                    waters.baking = false;
                    this.key_ = key;
                    waters.field_ = field;
                    waters.revision_++;
                }, (e) => { log.error('water', 'baking the water failed', e); });
            }
            if (!waters.field_) return;
            const eye = this.eye(app);
            this.ripple(app, inputs.zone, eye, app.getResource(Time).delta);
            if (!app.hasResource(Assets)) return;
            const surface = this.surface(app, inputs.zone, inputs.bodies.some((b) => b.kind === 'ocean'));
            if (surface.instance && surface.entity) this.update(app, surface, inputs.zone, eye ?? this.middle(inputs.grid));
        }, { name: 'WaterSystem' }));
    }

    cleanup(app?: App): void {
        if (app) this.carve(app, []);
        if (!app?.hasResource(WatersRes)) return;
        this.baking_?.cancel();
        this.baking_ = null;
        app.getResource(WatersRes).baking = false;
        this.dropRipples();
        this.dropSurface(app);
        const waters = app.getResource(WatersRes);
        waters.field_ = null;
        this.key_ = '';
        if (this.stock_) Material.release(this.stock_);
        this.stock_ = 0;
    }

    /**
     * Where the water is looked at from: the editor's own eye while a scene is being edited, the active camera otherwise, or null where
     * there is neither. The surface's fine cells are round this place: left on a scene's camera while the editor looked from somewhere
     * else, a river a kilometre off was drawn by cells wider than it is, and was not there.
     */
    private eye(app: App): [number, number, number] | null {
        if (app.hasResource(EditorView)) {
            const e = editorViewpoint(app.getResource(EditorView));
            if (e) return [e.x, e.y, e.z];
        }
        for (const entity of app.world.getEntitiesWithComponents([Camera, Transform])) {
            const camera = app.world.get(entity, Camera) as CameraData;
            if (!camera.isActive) continue;
            const t = app.world.get(entity, Transform) as TransformData;
            return [t.worldPosition.x, t.worldPosition.y, t.worldPosition.z];
        }
        return null;
    }

    /** The middle of the zone's region: where the surface and the ripples stay without a camera to follow. */
    private middle(grid: ZoneGrid): [number, number, number] {
        return [grid.minX + grid.sizeX / 2, 0, grid.minZ + grid.sizeZ / 2];
    }

    /**
     * The bodies as the zone takes them, in the world, the zone's settings, and the region they are baked over: the `WaterZone`'s, or without
     * one a region round every lake and river with a margin for their shores.
     */
    private gather(app: App): Inputs {
        const bodies: ZoneBody[] = [];
        const beds: Bed[] = [];
        const exclusions: ZoneExclusion[] = [];
        const keyParts: unknown[] = [];
        for (const entity of app.world.getEntitiesWithComponents([WaterBody, Transform])) {
            const d = app.world.get(entity, WaterBody) as WaterBodyData;
            const t = app.world.get(entity, Transform) as TransformData;
            const scale = t.worldScale.y || 1;
            const key = entity as number;
            if (d.form === WaterForm.Ocean) {
                bodies.push({ kind: 'ocean', key, level: t.worldPosition.y, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth, ...commonOf(d, 1), ...(d.surfaceLook === SurfaceLook.Own ? { color: [d.waterColor.r, d.waterColor.g, d.waterColor.b] as const } : {}) });
                keyParts.push([key, d.form, t.worldPosition.y, d.waveHeight, d.shoreWidth, d.surfaceLook, d.waterColor, commonKey(d)]);
            } else if (d.form === WaterForm.Lake) {
                const outline = outlineOf(d);
                bodies.push({
                    kind: 'lake', key, level: t.worldPosition.y, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth * scale, outline, ...commonOf(d, scale), ...(d.surfaceLook === SurfaceLook.Own ? { color: [d.waterColor.r, d.waterColor.g, d.waterColor.b] as const } : {}),
                    toLocal: (x, z) => { const q = toLocal(t, x, t.worldPosition.y, z, scale); return [q[0], q[2]]; },
                    toWorld: (x, z) => { const w = fromLocal(t, x, 0, z, scale); return [w[0], w[2]]; },
                });
                keyParts.push([key, d.form, outline, d.waveHeight, d.shoreWidth, t.worldPosition, t.worldRotation, scale, d.surfaceLook, d.waterColor, commonKey(d)]);
                if (d.affectsTerrain !== false && d.bedDepth > 0) {
                    const level = t.worldPosition.y, depth = d.bedDepth * scale, ramp = Math.max(d.shoreWidth * scale, depth * 3);
                    const space = outlineSpace(t, outline, scale), channel = channelOf(d, scale);
                    beds.push({ key, signature: JSON.stringify(['lake', outline, level, depth, ramp, t.worldPosition, t.worldRotation, scale, channel ? channelKey(d) : null]),
                        make: (prefix) => [channel ? lakeChannelModifier(`${prefix}floor`, space, level, depth, channel) : lakeFloorModifier(`${prefix}floor`, space, level, depth, ramp)] });
                }
            } else if (d.form === WaterForm.Island) {
                if (d.affectsTerrain === false) continue;
                const outline = outlineOf(d), top = t.worldPosition.y, falloff = d.shoreWidth * scale;
                const space = outlineSpace(t, outline, scale);
                beds.push({ key, signature: JSON.stringify(['island', outline, top, falloff, t.worldPosition, t.worldRotation, scale]),
                    make: (prefix) => [islandModifier(`${prefix}island`, space, top, falloff)] });
            } else if (d.form === WaterForm.Custom) {
                const shape = this.footprintOf(app, d.shapeMesh);
                // Not read yet: named in the key, so the water is baked again once it is.
                if (!shape) { keyParts.push([key, d.form, d.shapeMesh, this.footprints_.get(d.shapeMesh) ?? null]); continue; }
                const level = fromLocal(t, 0, shape.top, 0, scale)[1];
                bodies.push({
                    kind: 'lake', key, level, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth * scale, outline: shape.hull, ...commonOf(d, scale), ...(d.surfaceLook === SurfaceLook.Own ? { color: [d.waterColor.r, d.waterColor.g, d.waterColor.b] as const } : {}),
                    toLocal: (x, z) => { const q = toLocal(t, x, level, z, scale); return [q[0], q[2]]; },
                    toWorld: (x, z) => { const w = fromLocal(t, x, 0, z, scale); return [w[0], w[2]]; },
                    inside: (x, z) => shape.sdf(x, z),
                });
                keyParts.push([key, d.form, d.shapeMesh, 'shape', d.waveHeight, d.shoreWidth, t.worldPosition, t.worldRotation, scale, d.surfaceLook, d.waterColor, commonKey(d)]);
            } else if (d.form === WaterForm.Exclusion) {
                const outline = outlineOf(d), half = (d.sizeY * scale) / 2, y = t.worldPosition.y;
                const only = d.excludeAllOverlapping === false ? new Set((d.excludeBodies ?? []).map(Number)) : undefined;
                exclusions.push({ key, bottom: y - half, top: y + half, ...outlineSpace(t, outline, scale), ...(only ? { only } : {}) });
                keyParts.push([key, d.form, outline, d.sizeY, t.worldPosition, t.worldRotation, scale, only ? [...only] : 'all']);
            } else if (d.form === WaterForm.River) {
                const spline = app.world.tryGet(entity, Spline) as SplineData | null;
                if (!spline || spline.points.length < 2) continue;
                const curve = new SplineCurve(spline.points, spline.closed);
                const stations = riverStations(curve, d.flowSpeed, (x, y, z) => fromLocal(t, x, y, z, scale), (x, y, z) => rotate(t.worldRotation, x, y, z), scale);
                bodies.push({ kind: 'river', key, waveHeight: d.waveHeight, shoreWidth: d.shoreWidth * scale, stations, ...commonOf(d, scale), ...(d.surfaceLook === SurfaceLook.Own ? { color: [d.waterColor.r, d.waterColor.g, d.waterColor.b] as const } : {}) });
                if (d.affectsTerrain !== false && (d.bedDepth > 0 || stations.some((s) => (s.depth ?? 0) > 0))) {
                    const depth = d.bedDepth * scale, channel = channelOf(d, scale);
                    beds.push({ key, signature: JSON.stringify(['river', depth, stations, channel ? channelKey(d) : null]), make: (prefix) => riverBedModifiers(prefix, stations, depth, channel ?? undefined) });
                }
                keyParts.push([key, d.form, spline.points, spline.closed, d.flowSpeed, d.waveHeight, d.shoreWidth, t.worldPosition, t.worldRotation, scale, d.surfaceLook, d.waterColor, commonKey(d)]);
            }
        }
        // Which islands and exclusion volumes act on which body: those whose ground (their outline, grown by an island's slope) overlaps it.
        const boxOf = (pts: ReadonlyArray<[number, number]>, grow = 0): [number, number, number, number] => {
            let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
            for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
            return [x0 - grow, z0 - grow, x1 + grow, z1 + grow];
        };
        const bodyBoxes = bodies.map((b) => ({ key: b.key, box: b.kind === 'ocean' ? null
            : b.kind === 'river' ? boxOf(b.stations.map((s) => [s.x, s.z] as [number, number]), Math.max(...b.stations.map((s) => s.half)))
            : boxOf(b.outline.map((p) => b.toWorld(p.x, p.y))) }));
        const actors: Array<{ entity: number; kind: 'islands' | 'exclusions'; box: [number, number, number, number]; only?: ReadonlySet<number> }> = [];
        for (const entity of app.world.getEntitiesWithComponents([WaterBody, Transform])) {
            const d = app.world.get(entity, WaterBody) as WaterBodyData;
            if (d.form !== WaterForm.Island && d.form !== WaterForm.Exclusion) continue;
            const t = app.world.get(entity, Transform) as TransformData;
            const scale = t.worldScale.y || 1;
            const pts = outlineOf(d).map((p) => { const w = fromLocal(t, p.x, 0, p.y, scale); return [w[0], w[2]] as [number, number]; });
            const only = d.form === WaterForm.Exclusion && d.excludeAllOverlapping === false ? new Set((d.excludeBodies ?? []).map(Number)) : undefined;
            actors.push({ entity: entity as number, kind: d.form === WaterForm.Island ? 'islands' : 'exclusions', box: boxOf(pts, d.form === WaterForm.Island ? d.shoreWidth * scale : 0), only });
        }
        const influences = new Map<number, { islands: number[]; exclusions: number[] }>();
        for (const { key: bodyKey, box } of bodyBoxes) {
            const got = { islands: [] as number[], exclusions: [] as number[] };
            for (const a of actors) {
                if (box && (a.box[0] > box[2] || a.box[2] < box[0] || a.box[1] > box[3] || a.box[3] < box[1])) continue;
                if (a.only && !a.only.has(bodyKey)) continue;
                got[a.kind].push(a.entity);
            }
            influences.set(bodyKey, got);
        }
        let zoneEntity: number | null = null;
        let zone = zoneDefaults();
        let grid: ZoneGrid | null = null;
        let zoneLevel = 0;
        for (const entity of app.world.getEntitiesWithComponents([WaterZone, Transform])) {
            zone = app.world.get(entity, WaterZone) as WaterZoneData;
            const t = app.world.get(entity, Transform) as TransformData;
            grid = gridOver(t.worldPosition.x - zone.sizeX / 2, t.worldPosition.z - zone.sizeZ / 2, zone.sizeX, zone.sizeZ, zone.resolution);
            zoneLevel = t.worldPosition.y;
            zoneEntity = entity as number;
            break;
        }
        if (!grid) {
            grid = implicitGrid(bodies, zone);
            // The surface without a zone of its own reaches over the whole region from wherever the camera is in it: its cells grow with the region.
            const reach = oceanReach(zone.cells, zone.rings, zone.cellSize), need = Math.max(grid.sizeX, grid.sizeZ);
            if (reach < need) zone = { ...zone, cellSize: zone.cellSize * (need / reach) };
        }
        for (const b of bodies) b.exposure = exposureOf(b, zone.waveLength);
        const terrain = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const ground = terrain && terrain.built_.size > 0 ? terrain.revision_ : -1;
        return { bodies, beds, exclusions, zoneLevel, influences, zoneEntity, grid, zone, key: JSON.stringify([keyParts, grid, ground, zone.surfLength, zone.waveLength]) };
    }

    /**
     * Cuts each river's bed into the terrain, and gives the ground back where a river stops cutting or is gone. A bed is laid again only
     * when the river it is cut from changes: the water baked over the cut ground does not cut it again.
     */
    private carve(app: App, beds: readonly Bed[]): void {
        if (beds.length === 0 && this.beds_.size === 0) return;
        const terrains = app.hasResource(TerrainsRes) ? app.getResource(TerrainsRes) : null;
        const seen = new Set<number>();
        for (const bed of beds) {
            seen.add(bed.key);
            const signature = bed.signature;
            const had = this.beds_.get(bed.key);
            if (had?.signature === signature || !terrains) continue;
            for (const id of had?.ids ?? []) terrains.deleteModifier(id);
            const modifiers = bed.make(`water-ground:${bed.key}:`);
            for (const m of modifiers) terrains.setModifier(m);
            this.beds_.set(bed.key, { signature, ids: modifiers.map((m) => m.id) });
        }
        for (const [key, had] of this.beds_) {
            if (seen.has(key)) continue;
            if (terrains) for (const id of had.ids) terrains.deleteModifier(id);
            this.beds_.delete(key);
        }
    }

    /** A mesh's shape from above, once its geometry has been read; null while it is read or where there is none. */
    private footprintOf(app: App, mesh: number): Footprint | null {
        if (!mesh) return null;
        const had = this.footprints_.get(mesh);
        if (had !== undefined) return had === 'reading' ? null : had;
        if (!app.hasResource(Assets)) return null;
        this.footprints_.set(mesh, 'reading');
        void app.getResource(Assets).readMeshData(mesh)
            .then((data) => { this.footprints_.set(mesh, data ? Footprint.ofMesh(data) : null); })
            .catch(() => { this.footprints_.set(mesh, null); });
        return null;
    }

    /** The world height of the ground, where a terrain is built. */
    private ground(app: App): ZoneGround | undefined {
        if (!app.hasResource(TerrainsRes)) return undefined;
        const terrains = app.getResource(TerrainsRes);
        if (terrains.built_.size === 0) return undefined;
        return (x, z) => terrains.heightAt(x, z);
    }

    /** The material the surface is an instance of when the zone names none: the Water shader, compiled once. */
    private async stock(app: App): Promise<number> {
        if (this.stock_) return this.stock_;
        const assets = app.getResource(Assets);
        const source = await assets.load<MaterialShaderSource>('material-shader', 'builtin:water');
        const shader = source.compile([]);
        if (this.stock_) return this.stock_;
        this.stock_ = Material.createFromAsset({
            version: MATERIAL_FORMAT_VERSION, type: 'material', shader: 'builtin:water', blendMode: BlendMode.Normal,
            depthTest: true, depthWrite: true, cull: 0, properties: {},
        }, shader);
        return this.stock_;
    }

    /** The surface, made (or remade, where its mesh or its material changed) as the zone asks. */
    private surface(app: App, zone: WaterZoneData, ocean: boolean): Surface {
        const far = farOf(zone, ocean);
        const meshKey = JSON.stringify([zone.cells, zone.rings, zone.cellSize, far]);
        let s = this.surface_;
        if (s && (s.meshKey !== meshKey || s.material !== zone.material)) { this.dropSurface(app); s = null; }
        if (!s) {
            s = { entity: 0 as Entity, mesh: 0, meshKey, instance: 0, farEntity: 0 as Entity, farMesh: 0, farInstance: 0, material: zone.material, heights: 0, field: 0, exposure: 0, look: 0, baked: null, ripple: 0, rippleBytes: null, epoch: ++this.epoch_, pending: false, failure: null };
            this.surface_ = s;
        }
        if (!s.entity && !s.pending && !s.failure) void this.build_(app, s, zone, far);
        return s;
    }

    private async build_(app: App, s: Surface, zone: WaterZoneData, far: FarMesh | null): Promise<void> {
        s.pending = true;
        const epoch = s.epoch;
        try {
            const source = zone.material || await this.stock(app);
            if (s.epoch !== epoch || this.surface_ !== s) return;
            const assets = app.getResource(Assets);
            // The rings are where the waves are; past them the far distance mesh carries the sea to the horizon (see farOf), drawn apart so
            // it can take a cheaper material of its own.
            const mesh = assets.createMesh(buildOceanMesh(zone.cells, zone.rings, zone.cellSize));
            if (mesh === 0) { s.failure = 'the engine refused the water geometry'; log.warn('water', s.failure); return; }
            const instance = Material.createInstance(source);
            if (instance === 0) { assets.releaseBuiltMesh(mesh); s.failure = 'the water material could not be instanced'; log.warn('water', s.failure); return; }
            s.mesh = mesh;
            s.instance = instance;
            this.waters_.instance_ = instance;
            const entity = app.world.spawn('Water');
            app.world.insert(entity, Transform, { position: { x: 0, y: 0, z: 0 } });
            app.world.insert(entity, MeshRenderer, {
                // Light goes through water: the sun lights what is under it, through the caustics, and no shadow of the surface.
                mesh, material: instance, lit: true, opaque: false, cullBackfaces: false, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 },
            } as Partial<MeshRendererData>);
            s.entity = entity;
            const farData = far ? buildFarMesh(zone.cells, zone.rings, zone.cellSize, far.extent) : null;
            if (far && farData) {
                const farMesh = assets.createMesh(farData);
                // An instance of its own, of its own material or the rings': one instance drawn by two meshes drew neither with the Water shader.
                const farInstance = Material.createInstance(far.material || source);
                if (farMesh !== 0) {
                    s.farMesh = farMesh;
                    s.farInstance = farInstance;
                    const farEntity = app.world.spawn('Water Far');
                    app.world.insert(farEntity, Transform, { position: { x: 0, y: 0, z: 0 } });
                    app.world.insert(farEntity, MeshRenderer, {
                        mesh: farMesh, material: farInstance || instance, lit: true, opaque: false, cullBackfaces: false, castShadows: false, color: { r: 1, g: 1, b: 1, a: 1 },
                    } as Partial<MeshRendererData>);
                    s.farEntity = farEntity;
                } else if (farInstance) {
                    Material.release(farInstance);
                }
            }
        } catch (e) {
            if (s.epoch === epoch) s.failure = e instanceof Error ? e.message : String(e);
            log.error('water', 'building the water failed', e);
        } finally {
            s.pending = false;
        }
    }

    /** Puts the baked field where the shader reads it: the heights texel by texel, the rest filtered. */
    private upload(app: App, s: Surface, field: WaterField): void {
        this.dropFieldTextures(s);
        const ranges = field.ranges(this.waters_.zone_.surfLength * 4);
        const { heights, field: rest, exposure, look } = field.encode(ranges);
        const { nx, nz, minX, minZ, sizeX, sizeZ } = field.grid;
        const empty = nx < 2 || nz < 2;
        const w = empty ? 2 : nx, h = empty ? 2 : nz;
        s.heights = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16) : heights }, TextureContent.Retained, false,
            { filterMode: 'nearest', wrapMode: 'clamp', srgb: false });
        s.field = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16) : rest }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        s.exposure = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16).fill(255) : exposure }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        s.look = createTextureFromPixels(app.wasmModule, { width: w, height: h, pixels: empty ? new Uint8Array(16).map((_, i) => (i % 4 === 3 ? 255 : 0)) : look }, TextureContent.Retained, false,
            { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
        s.baked = field;
        const set = (name: string, value: Parameters<typeof Material.setUniform>[2]): void => { for (const i of drawnWith(s)) Material.setUniform(i, name, value); };
        set('u_zoneLook', Material.tex(s.look));
        set('u_zoneHeights', Material.tex(s.heights));
        set('u_zoneField', Material.tex(s.field));
        set('u_zoneExposure', Material.tex(s.exposure));
        // A region of nothing is put where no point is: everything is past it, which is the ocean.
        set('u_zoneOrigin', empty ? { x: 1e9, y: 1e9 } : { x: minX, y: minZ });
        set('u_zoneSize', empty ? { x: 1e-4, y: 1e-4 } : { x: sizeX, y: sizeZ });
        set('u_zoneHeight', { x: ranges.heightMin, y: ranges.heightSpan });
        set('u_zoneRange', { x: ranges.shore, y: ranges.amp, z: ranges.flow, w: ranges.depth });
        set('u_zoneOn', 1);
    }

    /** Writes the zone into the instance, and moves the surface to the camera on the lattice its rings line up on. */
    private update(app: App, s: Surface, zone: WaterZoneData, eye: [number, number, number]): void {
        const field = this.waters_.field_!;
        if (s.baked !== field) this.upload(app, s, field);
        const snap = oceanSnap(zone.rings, zone.cellSize);
        const ox = Math.round(eye[0] / snap) * snap, oz = Math.round(eye[2] / snap) * snap;
        const t = app.world.get(s.entity, Transform) as TransformData;
        if (t.position.x !== ox || t.position.z !== oz) app.world.insert(s.entity, Transform, { ...t, position: { x: ox, y: 0, z: oz } });
        if (s.farEntity && app.world.valid(s.farEntity)) {
            const f = app.world.get(s.farEntity, Transform) as TransformData;
            if (f.position.x !== ox || f.position.z !== oz) app.world.insert(s.farEntity, Transform, { ...f, position: { x: ox, y: 0, z: oz } });
        }
        const set = (name: string, value: number | { x: number; y: number }): void => { for (const i of drawnWith(s)) Material.setUniform(i, name, value); };
        const q = this.waters_.quality;
        const ocean = field.ocean;
        const waves = waveParamsOf(zone);
        set('u_waveCount', q.waves);
        set('u_mirror', q.mirror ? 1 : 0);
        set('u_causticOn', q.caustics ? 1 : 0);
        set('u_reflectSteps', q.reflectionSteps);
        set('u_reflectGrowth', waterReflectionGrowth(q.reflectionSteps));
        set('u_causticLayers', q.causticLayers);
        set('u_waveSpace', 1);
        set('u_origin', { x: ox, y: oz });
        set('u_cellSize', zone.cellSize);
        set('u_geoWaves', q.displacement ? 1 : 0);
        set('u_waveHeight', waves.height);
        set('u_rain', rainOnWater());
        set('u_waveLength', waves.length);
        set('u_waveSpeed', waves.speed);
        set('u_waveDirection', waves.direction);
        set('u_oceanOn', ocean ? 1 : 0);
        set('u_oceanLevel', ocean ? ocean.level : 0);
        set('u_oceanWaves', ocean ? ocean.waveHeight : 0);
        // Past the region the ocean's own colour, where it has one.
        const oceanLook = ocean?.color ? { x: ocean.color[0], y: ocean.color[1], z: ocean.color[2], w: 1 } : { x: 0, y: 0, z: 0, w: 0 };
        for (const i of drawnWith(s)) Material.setUniform(i, 'u_oceanLook', oceanLook);
        // A zone with no ocean that asks for the far distance mesh: that mesh alone takes the open sea past the region, flat, at the zone's
        // own height, while the rings keep to the lakes and rivers baked in it.
        if (!ocean && s.farInstance) {
            Material.setUniform(s.farInstance, 'u_oceanOn', 1);
            Material.setUniform(s.farInstance, 'u_oceanLevel', this.waters_.zoneLevel_);
            Material.setUniform(s.farInstance, 'u_oceanWaves', 0);
        }
        set('u_surfHeight', zone.surf);
        set('u_surfLength', zone.surfLength);
        set('u_surfSpeed', zone.waveSpeed);
    }

    /**
     * Keeps the zone's ripples: makes the grid when `ripples` asks for one, moves its window to the camera, steps it, and (where drawn) puts it where the shader reads it.
     * It runs headless too, so the surface a test or a server asks about has them.
     */
    private ripple(app: App, zone: WaterZoneData, eye: [number, number, number] | null, dt: number): void {
        const waters = this.waters_;
        if (zone.ripples <= 0 || waters.quality.rippleCells <= 0) { this.dropRipples(); return; }
        // The level holds the grid to its own side; a zone that asks for more gets the level's.
        const n = Math.max(8, Math.floor(Math.min(zone.ripples, waters.quality.rippleCells))), size = Math.max(zone.rippleSize, 1e-3);
        if (!waters.ripples_ || waters.ripples_.n !== n || waters.ripples_.size !== size) {
            this.dropRipples();
            waters.ripples_ = new RippleField(n, size);
            const grid = waters.field_!.grid;
            waters.ripples_.recenter(grid.minX + grid.sizeX / 2, grid.minZ + grid.sizeZ / 2);
        }
        const field = waters.ripples_;
        if (eye) field.recenter(eye[0], eye[2]);
        const step = Math.min(Math.max(dt, 0), 0.1);
        field.step(step, zone.rippleSpeed, zone.rippleDamping, zone.foamFade);
        const s = this.surface_;
        if (!s || !s.instance || !app.hasResource(Assets)) return;
        // The height the grid holds and its encoding spans either side of rest: twice the tallest waves, or a fiftieth of the window where the water is calm.
        const range = Math.max((waters.field_ ? waters.field_.ranges().amp : 0) * weatherWaves() * 2, zone.rippleSize * 0.02);
        field.limit = range;
        const bytes = field.encode(range, s.rippleBytes ?? undefined);
        s.rippleBytes = bytes;
        if (!s.ripple) {
            s.ripple = createTextureFromPixels(app.wasmModule, { width: n, height: n, pixels: bytes }, TextureContent.Retained, false,
                { filterMode: 'linear', wrapMode: 'clamp', srgb: false });
            const handle = s.ripple;
            provideTextureContent(handle, () => {
                if (s.ripple !== handle || !s.rippleBytes) return false;
                updateTextureSubregion(app.wasmModule, handle, 0, 0, n, n, s.rippleBytes);
                return true;
            });
            for (const i of drawnWith(s)) Material.setUniform(i, 'u_rippleMap', Material.tex(handle));
        } else {
            updateTextureSubregion(app.wasmModule, s.ripple, 0, 0, n, n, bytes);
        }
        const set = (name: string, value: number | { x: number; y: number }): void => { for (const i of drawnWith(s)) Material.setUniform(i, name, value); };
        set('u_rippleOn', 1);
        set('u_rippleOrigin', { x: field.originX, y: field.originZ });
        set('u_rippleSize', field.size);
        set('u_rippleTexel', 1 / n);
        set('u_rippleRange', range);
    }

    private dropRipples(): void {
        const s = this.surface_;
        if (s?.ripple) {
            withdrawTextureContent(s.ripple);
            getResourceManager()?.releaseTexture(s.ripple);
        }
        if (s) {
            s.ripple = 0;
            s.rippleBytes = null;
            for (const i of drawnWith(s)) Material.setUniform(i, 'u_rippleOn', 0);
        }
        this.waters_.ripples_ = null;
    }

    private dropFieldTextures(s: Surface): void {
        const rm = getResourceManager();
        if (s.heights) rm?.releaseTexture(s.heights);
        if (s.field) rm?.releaseTexture(s.field);
        if (s.exposure) rm?.releaseTexture(s.exposure);
        if (s.look) rm?.releaseTexture(s.look);
        s.look = 0;
        s.heights = 0;
        s.field = 0;
        s.exposure = 0;
        s.baked = null;
    }

    private dropSurface(app: App): void {
        const s = this.surface_;
        if (!s) return;
        s.epoch = ++this.epoch_;
        this.surface_ = null;
        if (s.entity && app.world.valid(s.entity)) app.world.despawn(s.entity);
        if (s.farEntity && app.world.valid(s.farEntity)) app.world.despawn(s.farEntity);
        if (s.farInstance) Material.release(s.farInstance);
        if (s.farMesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(s.farMesh);
        if (s.ripple) { withdrawTextureContent(s.ripple); getResourceManager()?.releaseTexture(s.ripple); }
        this.waters_.ripples_ = null;
        this.dropFieldTextures(s);
        if (s.instance) Material.release(s.instance);
        if (s.mesh && app.hasResource(Assets)) app.getResource(Assets).releaseBuiltMesh(s.mesh);
        this.waters_.instance_ = 0;
    }
}

/** The far distance mesh a zone asks for: how far it reaches and the material it is drawn with (0: the zone's water). */
interface FarMesh { extent: number; material: number }

/** The far distance mesh the zone draws, or null: off, or a zone with no ocean that does not ask for one without. */
function farOf(zone: WaterZoneData, ocean: boolean): FarMesh | null {
    if (!zone.farDistance || !(ocean || zone.farMeshWithoutOcean)) return null;
    return { extent: zone.farDistanceExtent, material: zone.farDistanceMaterial };
}

/** The material instances the surface is drawn with: the rings', and the far mesh's own where it has one. Both take every uniform the plugin writes. */
function drawnWith(s: Surface): number[] {
    return [s.instance, s.farInstance].filter((i) => i !== 0);
}

/** A region from (minX, minZ), `sizeX` by `sizeZ`, with `resolution` texels along its longer side. */
function gridOver(minX: number, minZ: number, sizeX: number, sizeZ: number, resolution: number): ZoneGrid {
    const longer = Math.max(sizeX, sizeZ, 1e-3);
    const res = Math.max(2, Math.round(resolution));
    return { minX, minZ, sizeX, sizeZ, nx: Math.max(2, Math.round((res * sizeX) / longer)), nz: Math.max(2, Math.round((res * sizeZ) / longer)) };
}

/**
 * The region a scene without a `WaterZone` is baked over: round every lake and river, with a margin of their shores and a few texels, at half
 * the surface's finest cell to a texel (no finer than 32 texels along its longer side, no coarser than 1024). None, when there is only an ocean.
 */
function implicitGrid(bodies: readonly ZoneBody[], zone: WaterZoneData): ZoneGrid {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, margin = 0;
    for (const b of bodies) {
        if (b.kind === 'ocean') continue;
        margin = Math.max(margin, b.shoreWidth);
        if (b.kind === 'river') {
            for (const s of b.stations) {
                minX = Math.min(minX, s.x - s.half); maxX = Math.max(maxX, s.x + s.half);
                minZ = Math.min(minZ, s.z - s.half); maxZ = Math.max(maxZ, s.z + s.half);
            }
        } else {
            for (const p of b.outline) {
                const [x, z] = b.toWorld(p.x, p.y);
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
            }
        }
    }
    if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, sizeX: 0, sizeZ: 0, nx: 0, nz: 0 };
    const longer = Math.max(maxX - minX, maxZ - minZ);
    const res = Math.min(1024, Math.max(32, Math.ceil(longer / Math.max(zone.cellSize * 0.5, 1e-3))));
    const pad = margin + (longer / res) * 4;
    return gridOver(minX - pad, minZ - pad, maxX - minX + pad * 2, maxZ - minZ + pad * 2, res);
}

export const waterPlugin: Plugin = /* @__PURE__ */ new WaterPlugin();
