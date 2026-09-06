// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  textureFormatReport.ts
 * @brief What the textures this realm loaded actually became on the GPU.
 *
 *        A cooked KTX2 that the device cannot sample is decoded to RGBA and
 *        uploaded — correctly, four times larger, and until now with nothing
 *        anywhere saying so. This is the ledger of those decisions, kept where
 *        they are taken (the loader) and therefore scoped to the realm that took
 *        them, so a report never outlives the textures it describes.
 *
 *        `deviceFormats` is the INPUT, not an outcome: the formats this machine
 *        samples at all. Empty with `deviceProbed` false means nobody could be
 *        asked yet — a different answer from "this device supports none", and
 *        collapsing them is how "0" reads as a fact instead of a silence.
 */
import type { CompressedTextureFormat, TextureUploadDecision } from './compressed';

export interface TextureFormatRecord extends TextureUploadDecision {
    /** The residency key the texture was loaded under. */
    readonly path: string;
}

export interface TextureFormatReport {
    /** Compressed formats this device samples, best first. */
    readonly deviceFormats: readonly CompressedTextureFormat[];
    /** Whether anything was in a position to answer the question. */
    readonly deviceProbed: boolean;
    readonly textures: readonly TextureFormatRecord[];
    /** Compressed payloads that stayed compressed. */
    readonly compressed: number;
    /** Compressed payloads decoded to RGBA — the ones that cost 4x their VRAM. */
    readonly decoded: number;
}

/**
 * The per-realm ledger. One record per residency key: a texture revived from the
 * pool under the same key made the same decision, and a second row would count
 * one texture's memory twice.
 */
export class TextureFormatLog {
    private readonly rows_ = new Map<string, TextureFormatRecord>();

    record(path: string, decision: TextureUploadDecision): void {
        this.rows_.set(path, { path, ...decision });
    }

    report(deviceFormats: readonly CompressedTextureFormat[], deviceProbed: boolean): TextureFormatReport {
        const textures = [...this.rows_.values()];
        let compressed = 0;
        let decoded = 0;
        for (const r of textures) {
            if (r.payload !== 'ktx2') continue;
            if (r.reason === 'compressed') compressed++;
            else decoded++;
        }
        return { deviceFormats, deviceProbed, textures, compressed, decoded };
    }

    clear(): void {
        this.rows_.clear();
    }
}

/**
 * The record for one asset path, whichever flip orientation it loaded under.
 *
 * Rows are keyed by residency key (path + flip), so a caller holding a plain
 * asset path cannot look one up — and a caller that reconstructed the key would
 * own a copy of a shape that is not its to know.
 */
export function textureFormatOf(
    report: TextureFormatReport | null, path: string,
): TextureFormatRecord | null {
    return report?.textures.find((t) => t.path.startsWith(`${path}:`)) ?? null;
}
