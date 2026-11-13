// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recipeSource.ts
 * @brief   What an `.esimage` shipped as a texture says: a picture, or one of the surface maps of another picture.
 *
 * @details A picture with a `material` is a surface as well as a colour: a normal map and a roughness-and-metal map are drawn from
 *          the same layers. A map is a texture of its own (it has its own import settings: data, not colour), so it is a file of
 *          its own: `{ "mapOf": "assets/wall.esimage", "map": "normal" }`. Nothing is drawn twice in the source, and a wall whose
 *          layers change changes its maps with it.
 */
import { validateImageSource, type ImageLayer, type ImageSource } from './imageSource';

/** The maps a picture with a `material` has beside its colour. */
export const RECIPE_MAPS = ['normal', 'surface'] as const;
export type RecipeMap = (typeof RECIPE_MAPS)[number];

/** A recipe that is a surface map of the picture at `mapOf` (a project path). */
export interface ImageMapSource { version?: number; mapOf: string; map: RecipeMap }

export type Recipe = { picture: ImageSource } | { map: ImageMapSource };

const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

/** Whether a text layer's `font` names a file of the project and not a family the device has. */
export const isFontFile = (font: string): boolean => FONT_FILE.test(font);

/** A recipe from its text, checked: a wrong one says what is wrong. */
export function parseRecipe(text: string): Recipe {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw === null || typeof raw !== 'object' || !('mapOf' in raw)) return { picture: validateImageSource(raw) };
    const { mapOf, map } = raw;
    if (typeof mapOf !== 'string' || !mapOf.toLowerCase().endsWith('.esimage')) throw new Error('mapOf must be the project path of an .esimage');
    if (!RECIPE_MAPS.includes(map as RecipeMap)) throw new Error(`map must be one of ${RECIPE_MAPS.join(', ')}`);
    const extra = Object.keys(raw).filter((k) => k !== 'mapOf' && k !== 'map' && k !== 'version');
    if (extra.length > 0) throw new Error(`a map of a picture says only mapOf and map, and this one also says ${extra.join(', ')}`);
    return { map: { mapOf, map: map as RecipeMap } };
}

/** Every layer of a picture, those inside groups and those its material draws included. */
function* layersOf(source: ImageSource): Generator<ImageLayer> {
    function* within(layers: readonly ImageLayer[]): Generator<ImageLayer> {
        for (const l of layers) {
            yield l;
            yield* within(l.layers ?? []);
        }
    }
    yield* within(source.layers);
    for (const drawn of [source.material?.height, source.material?.roughness, source.material?.metal]) {
        if (Array.isArray(drawn)) yield* within(drawn as readonly ImageLayer[]);
    }
}

/** The pictures a source lays in and the font files its text is set in, by project path. */
export function pictureNeeds(source: ImageSource): { pictures: string[]; fonts: string[]; text: boolean } {
    const pictures = new Set<string>(), fonts = new Set<string>();
    let text = false;
    for (const l of layersOf(source)) {
        if (l.shape === 'image' && l.src) pictures.add(l.src);
        if (l.shape === 'text') {
            text = true;
            if (l.font && isFontFile(l.font)) fonts.add(l.font);
        }
    }
    return { pictures: [...pictures], fonts: [...fonts], text };
}

/** The project files a recipe needs beside itself. */
export function recipeNeeds(text: string): string[] {
    const recipe = parseRecipe(text);
    if ('map' in recipe) return [recipe.map.mapOf];
    const { pictures, fonts } = pictureNeeds(recipe.picture);
    return [...pictures, ...fonts];
}
