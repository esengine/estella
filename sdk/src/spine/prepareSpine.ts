// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    prepareSpine.ts
 * @brief   What one spine asset IS, and the one algorithm that produces it.
 *
 * @details A spine asset is a PAIR: a skeleton document and the atlas it is
 *          drawn with. The same skeleton with another atlas is another asset —
 *          the component authors both fields, so a scene can and does say so —
 *          which is why the pair, not the skeleton's path, is its identity.
 *
 *          What a preparation produces is data: the two documents and the atlas
 *          pages it took. The native skeleton is NOT here. That object belongs
 *          to a runtime backend of a particular Spine version, is built from
 *          this, and dies with the entities using it — an asset layer that
 *          creates one owns something it cannot answer questions about.
 *
 *          The transport differs by host — the asset layer's recording context,
 *          an editor's own file access — and the algorithm does not. Which pages
 *          the atlas names, where they live, what is read and what is acquired
 *          is decided once, here.
 */
import { requireResourceManager } from '../wasm/resourceManager';
import type { AssetLease } from '../asset/AssetLease';
import { parseSpineAtlasPages } from './atlasPages';
import { log } from '../util/logger';
import type { SpineCullingEnvelope } from './spineBounds';

/** One atlas page, as the runtime needs it: a GL id and its size. */
export interface SpinePage {
    glId: number;
    w: number;
    h: number;
}

/** What a spine preparation produced. */
export interface SpineAssetValue {
    /** The skeleton document — bytes for `.skel`, text for `.json`. */
    skelData: Uint8Array | string;
    atlasText: string;
    isBinary: boolean;
    /** By the name the atlas gives each page. */
    textures: Map<string, SpinePage>;
}

/**
 * What a spine preparation needs from the world it runs in.
 *
 * `text`/`binary` READ: those bytes decide what this asset becomes and nothing
 * holds them afterwards. `page` TAKES: whether a receipt comes back with it is
 * the transport's business — the asset layer's records one.
 */
export interface SpineIO {
    text(ref: string): Promise<string>;
    binary(ref: string): Promise<ArrayBuffer>;
    page(path: string): Promise<{ handle: number; width: number; height: number }>;
    /** Where the page the atlas names `name` actually lives. */
    pagePath(name: string): string;
    /** Whether the skeleton document is bytes rather than text — the extension
     *  of where it actually IS, which a uuid ref does not carry. */
    isBinary(ref: string): boolean;
}

/** A claim on an era, held by something derived from it. */
export interface SpineEraClaim {
    release(): void;
}

/**
 * One prepared era, and the right to keep it alive.
 *
 * Indivisible on purpose: a runtime that was handed an id and a separate way to
 * keep something alive can be handed the id of one generation and a claim on
 * another. What it retains is always the generation whose bytes it parsed.
 */
export interface SpineEraBinding {
    /** Which era — what a runtime keys its native residency by. */
    readonly id: string;
    readonly value: SpineAssetValue;
    /**
     * A claim on THIS generation. Never a fresh acquisition by name: after an
     * invalidate that name resolves to a different era than the one this native
     * skeleton was parsed from. Null when the era can no longer be joined.
     */
    retain(): SpineEraClaim | null;

    /**
     * What culling may assume about this asset's extent. Carried with the era
     * because a residency is made from one, but it belongs to the PAIR: a
     * promise about the asset survives the generation it was read beside.
     */
    readonly culling: SpineCullingEnvelope;
}

/** The era binding for an acquired spine asset: identity is the pair plus the
 *  generation, and the claim is a retain of exactly that generation. */
export function spineEraOf(
    key: string, lease: AssetLease<SpineAssetValue>,
    culling: SpineCullingEnvelope = { kind: 'unknown' },
): SpineEraBinding {
    return {
        id: `${key}#${lease.generation}`,
        value: lease.value,
        retain: () => lease.retain(),
        culling,
    };
}

/** The identity of a spine asset in one realm: the pair, in one string. */
export function spinePairKey(skeleton: string, atlas: string): string {
    return `${skeleton}:${atlas}`;
}

/**
 * Prepare one spine pair. A page that fails to load is left out with a warning
 * rather than failing the asset: a skeleton missing one page still poses, and
 * the atlas naming a page the build dropped is the ordinary shape of it.
 */
export async function prepareSpine(
    io: SpineIO, skeletonRef: string, atlasRef: string,
): Promise<SpineAssetValue> {
    const atlasText = await io.text(atlasRef);
    const rm = requireResourceManager();
    const textures = new Map<string, SpinePage>();

    for (const name of parseSpineAtlasPages(atlasText)) {
        const path = io.pagePath(name);
        try {
            const page = await io.page(path);
            rm.registerTextureWithPath(page.handle, path);
            textures.set(name, { glId: rm.getTextureGLId(page.handle), w: page.width, h: page.height });
        } catch (e) {
            log.warn('spine', `atlas page "${path}" did not load`, e);
        }
    }

    const isBinary = io.isBinary(skeletonRef);
    const skelData: Uint8Array | string = isBinary
        ? new Uint8Array(await io.binary(skeletonRef))
        : await io.text(skeletonRef);

    return { skelData, atlasText, isBinary, textures };
}
