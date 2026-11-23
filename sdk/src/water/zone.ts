// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zone.ts
 * @brief   A water zone: every body of water in a region baked into one field, which one surface is drawn from.
 *
 * @details Bodies of water drawn each as a mesh of its own are separate surfaces, and where a river runs into a lake or the sea they meet
 *          along a seam: two heights, two sets of waves, a shore foaming across the river's mouth, a ribbon's edge showing over the lake.
 *          So a body of water is not drawn: it is an INPUT. A zone gathers the bodies over its region and bakes them into a grid, each
 *          texel holding what the water is there:
 *            - the height of its surface (a lake's level, the height of a river's curve at its nearest place, the sea's level);
 *            - the signed distance to the nearest shore (positive on the water): where the surface is cut and where it foams;
 *            - how high its waves stand there (a body's own height, calmed toward its shore and as the water shallows);
 *            - how it flows (a river's current), and how deep it is over the ground.
 *          Where two bodies meet their values are blended by how far inside each the texel is, so a river is at its lake's level where it runs
 *          into it, its current fades into the still water, and its banks run on into the lake's shores with no seam; the sea gives way to
 *          the bodies over it. One mesh following the camera reads the field and is the whole surface, and {@link WaterField.sample} answers
 *          the CPU from the same numbers.
 *
 *          The field is in the world's own frame on the xz plane: bodies may be turned about their up, not tilted.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';

/** The fields of the `WaterZone` component. @experimental */
export interface WaterZoneData {
    /** The region baked, along x and z, centred on the entity. Bodies (or the parts of them) outside it are not drawn; an ocean goes on past it. */
    sizeX: number;
    sizeZ: number;
    /** Texels along the longer side of the region. */
    resolution: number;
    /** Default Water surface material inherited by bodies without an override. Empty selects the stock water. */
    material: number;
    /** The waves every body shares (each sets only how high they stand): the length of the longest, a multiplier on their speed, their heading in degrees. */
    waveLength: number;
    waveSpeed: number;
    waveDirection: number;
    /** The surf: how high a breaker stands against its body's waves (0 draws none), and how long the surf's waves are, in world units. */
    surf: number;
    surfLength: number;
    /** Directional spread of the incoming shore break, from straight crests (0) to crossing swell (1). */
    surfSpread?: number;
    /** Width of a base tile in project units. Zero derives it from the old cell settings. */
    tileSize: number;
    /** Base tiles from the zone centre to either edge along X and Z. */
    extentInTiles: { x: number; y: number };
    /** The number of cells on a tile side is two to this power. */
    tessellationFactor: number;
    /** Distance at which a tile splits, in tile widths. */
    lodScale: number;
    /** First level allowed to merge partly wet tiles. Negative preserves the shoreline. */
    forceCollapseDensityLevel: number;
    /** Finest cell size of scenes using the legacy ring settings. */
    cellSize: number;
    cells: number;
    rings: number;
    /** Cells along a side of the ripple grid; 0 keeps none. The grid is a window of `rippleSize` that follows the camera. */
    ripples: number;
    rippleSize: number;
    /** How fast a ripple spreads (world units a second), how much of its height it loses a second, and how fast the foam it leaves fades a second. */
    rippleSpeed: number;
    rippleDamping: number;
    foamFade: number;
    /**
     * The far distance mesh: past the rings, a flat sea out to `farDistanceExtent` from the camera, so an ocean reaches the horizon and does not
     * end in a straight line where the rings do. Drawn with `farDistanceMaterial` (empty: the zone's own water), and only where the zone has an
     * ocean unless `farMeshWithoutOcean`.
     */
    farDistance: boolean;
    farDistanceExtent: number;
    farDistanceMaterial: number;
    farMeshWithoutOcean: boolean;
}

/**
 * Where the bodies of water are drawn from, and what they share. A scene without one is given a zone over its lakes and rivers with these
 * defaults; put one in to say where, how fine, and what the water looks like.
 *
 * @experimental
 */
export const WaterZone: ComponentDef<WaterZoneData> = /* @__PURE__ */ defineComponent<WaterZoneData>('WaterZone', {
    // Lengths at the engine's reference of 100 units a metre (ecs/worldUnits.ts): 14 m waves on metre cells in any project.
    sizeX: 20000, sizeZ: 20000, resolution: 256, material: 0,
    waveLength: 1400, waveSpeed: 1, waveDirection: 30, surf: 0.6, surfLength: 800, surfSpread: 0,
    tileSize: 0, extentInTiles: { x: 0, y: 0 }, tessellationFactor: 3, lodScale: 1, forceCollapseDensityLevel: -1,
    cellSize: 100, cells: 64, rings: 5,
    ripples: 0, rippleSize: 6400, rippleSpeed: 600, rippleDamping: 0.8, foamFade: 0.4,
    // 80 km: further than a camera a kilometre up can see.
    farDistance: true, farDistanceExtent: 8000000, farDistanceMaterial: 0, farMeshWithoutOcean: false,
}, {
    worldUnitFields: ['sizeX', 'sizeZ', 'waveLength', 'surfLength', 'tileSize', 'cellSize', 'rippleSize', 'rippleSpeed', 'farDistanceExtent'],
    assetFields: [{ field: 'material', type: 'material' }, { field: 'farDistanceMaterial', type: 'material' }],
    fields: {
        sizeX: { min: 1, category: 'Region', tooltip: 'The region baked along x, centred on the entity. Water outside it is not drawn; an ocean goes on past it.' },
        sizeZ: { min: 1, category: 'Region', tooltip: 'The region baked along z, centred on the entity.' },
        resolution: { min: 32, max: 1024, step: 32, category: 'Region', tooltip: 'Texels along the longer side of the region: how finely shores and rivers are traced.' },
        material: { category: 'Look', tooltip: 'Default Water surface material inherited by bodies without an override. Empty selects the stock water.' },
        waveLength: { min: 0.5, max: 3000, category: 'Waves', tooltip: 'The length of the longest wave. Every body shares the waves; each sets how high they stand.' },
        waveSpeed: { min: 0, max: 4, category: 'Waves', tooltip: 'A multiplier on how fast the waves travel.' },
        waveDirection: { min: 0, max: 360, category: 'Waves', tooltip: 'The heading of the waves, in degrees.' },
        surf: { min: 0, max: 4, category: 'Waves', tooltip: 'How high the surf breaking on a shore stands against its body\'s waves. 0 draws none. A current carries none.' },
        surfSpread: { min: 0, max: 1, category: 'Waves', tooltip: 'Bends incoming crests along the beach. Run-up, spray sampling and refracted light follow the same crest field.' },
        surfLength: { min: 0.1, max: 100000, category: 'Waves', tooltip: 'The length of the surf\'s waves, in world units. They run in over four lengths of water, break, and run up the ground past the shore.' },
        forceCollapseDensityLevel: { min: -1, max: 9, step: 1, category: 'Mesh', tooltip: 'First level allowed to merge partially wet tiles. -1 retains the shoreline silhouette.' },
        tileSize: { min: 0, category: 'Mesh', tooltip: 'Width of a base tile in project units. Zero uses the legacy cell size.' },
        extentInTiles: { label: 'Extent in Tiles (X, Z)', category: 'Mesh', tooltip: 'Base tiles from the zone centre to each edge. Zero inherits the old ring extent on that axis.' },
        tessellationFactor: { min: 1, max: 6, step: 1, category: 'Mesh', tooltip: 'A tile has two to this power cells per side. Controls vertex density independently of tile size.' },
        lodScale: { label: 'LOD Scale', min: 0.5, max: 4, step: 0.1, category: 'Mesh', tooltip: 'Split distance in tile widths. Larger values retain more detail farther from the eye.' },
        cellSize: { shownWhen: { field: 'tileSize', values: [0] }, min: 0.05, category: 'Detail', tooltip: 'Used while Tile Size is 0. The cell size of the finest ring of the surface. Waves shorter than six cells are not drawn as geometry there (the shading still shows them).' },
        cells: { shownWhen: { field: 'tileSize', values: [0] }, min: 4, max: 256, step: 4, category: 'Detail', tooltip: 'Cells along a ring\'s side.' },
        rings: { shownWhen: { field: 'tileSize', values: [0] }, min: 1, max: 10, step: 1, category: 'Detail', tooltip: 'Rings of the surface, each twice as coarse as the one inside it.' },
        ripples: { min: 0, max: 256, step: 8, category: 'Ripples', tooltip: 'Cells along a side of the grid that keeps what disturbs the water: bodies moving in it, rain, and what a script disturbs. 0 keeps none.' },
        rippleSize: { min: 4, category: 'Ripples', tooltip: 'The side of the window the ripples are kept in, in world units. It follows the camera.' },
        rippleSpeed: { min: 0.1, max: 4000, category: 'Ripples', tooltip: 'How fast a ripple spreads, in world units a second.' },
        rippleDamping: { min: 0, max: 10, category: 'Ripples', tooltip: 'How much of its height a ripple loses each second.' },
        foamFade: { min: 0, max: 10, category: 'Ripples', tooltip: 'How fast the foam a disturbance leaves fades, a second.' },
        farDistance: { category: 'Far Distance', tooltip: 'Extend the ocean from the tiled region to the far distance using a flat, eight-triangle mesh just below sea level.' },
        farDistanceExtent: { shownWhen: { field: 'farDistance', values: [1] }, min: 1, category: 'Far Distance', tooltip: 'Distance from the centre of the tiled surface to the outer edge of the far mesh, in project units.' },
        farDistanceMaterial: { shownWhen: { field: 'farDistance', values: [1] }, category: 'Far Distance', tooltip: 'The material the far distance mesh is drawn with: a cheaper one on the Water shader, matched to the ocean so the two meet without a seam. Empty uses the deep colour and sky reflection of the zone water.' },
        farMeshWithoutOcean: { shownWhen: { field: 'farDistance', values: [1] }, category: 'Far Distance', tooltip: 'Draw the far distance mesh when the zone has no ocean too. Off, a zone of lakes and rivers alone has none.' },
    },
});

// The bodies and the field they bake into live apart from the component, so the baking worker need not carry the ECS.
export * from './zoneField';
