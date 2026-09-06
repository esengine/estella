// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The upload half of a texture's compression: what a cooked payload became
 *        on THIS device, and why it is not what shipped.
 *
 * Pure over the two inputs that decide it — what the device offered and whether
 * the transcode worked — so it holds with no GL context and no basis module.
 */
import { describe, it, expect } from 'vitest';
import {
    CompressedTextureFormat, TARGET_PREFERENCE,
    compressedUploadDecision, hostUploadDecision, supportedTargetFormats,
    formatFromEngineCode, engineFormatCode, RAW_PAYLOAD_UPLOAD,
} from '../src/asset/compressed';
import { TextureFormatLog, textureFormatOf } from '../src/asset/textureFormatReport';

const ASTC = CompressedTextureFormat.ASTC_4x4;
const ETC2 = CompressedTextureFormat.ETC2_RGBA8;
const S3TC = CompressedTextureFormat.S3TC_DXT5;

describe('compressedUploadDecision', () => {
    it('keeps the format when the device offered one and it transcoded', () => {
        expect(compressedUploadDecision(ASTC, true)).toEqual({
            payload: 'ktx2', target: ASTC, effective: ASTC, reason: 'compressed',
        });
    });

    it('separates a device that offers nothing from a payload that would not transcode', () => {
        // Both end at RGBA8 and both cost the same memory; only one is fixed by
        // re-cooking the asset, which is why one reason would be useless.
        const noDevice = compressedUploadDecision(null, false);
        const badPayload = compressedUploadDecision(ETC2, false);
        expect(noDevice.reason).toBe('no-device-format');
        expect(badPayload.reason).toBe('transcode-failed');
        expect(noDevice.target).toBeNull();
        expect(badPayload.target).toBe(ETC2);
        expect(noDevice.effective).toBe('rgba8');
        expect(badPayload.effective).toBe('rgba8');
    });

    it('an ordinary image is not a fallback', () => {
        // The gamma-project lesson: `effective === rgba8` covers "asked and was
        // refused" AND "never asked", and only the payload tells them apart. A
        // project that never turned compression on must see no warning at all.
        expect(RAW_PAYLOAD_UPLOAD.payload).toBe('raw');
        expect(RAW_PAYLOAD_UPLOAD.reason).toBe('uncompressed-payload');
        expect(compressedUploadDecision(null, false).payload).toBe('ktx2');
    });
});

describe('hostUploadDecision (native)', () => {
    it('reads back the engine ordinal it uploaded', () => {
        for (const f of TARGET_PREFERENCE) {
            for (const srgb of [false, true]) {
                const d = hostUploadDecision(engineFormatCode(f, srgb), false);
                expect(d.effective).toBe(f);
                expect(d.reason).toBe('compressed');
            }
        }
    });

    it('names the image, not the device, when the blocks were the refusal', () => {
        expect(hostUploadDecision(-1, true).reason).toBe('not-block-aligned');
        expect(hostUploadDecision(-1, false).reason).toBe('no-device-format');
    });

    it('a host that answers nothing is read as "this device offered none", never as success', () => {
        expect(hostUploadDecision(-1, false).effective).toBe('rgba8');
    });

    it('formatFromEngineCode maps both the unorm and sRGB spellings of one target', () => {
        expect(formatFromEngineCode(engineFormatCode(ASTC, false))).toBe(ASTC);
        expect(formatFromEngineCode(engineFormatCode(ASTC, true))).toBe(ASTC);
        expect(formatFromEngineCode(0)).toBeNull();   // ETC2_RGB8 — no loader targets it
        expect(formatFromEngineCode(-1)).toBeNull();
    });
});

describe('supportedTargetFormats', () => {
    it('answers in the one preference order, best first', () => {
        expect(supportedTargetFormats(() => true)).toEqual([ASTC, ETC2, S3TC]);
        expect(supportedTargetFormats((f) => f !== ASTC)).toEqual([ETC2, S3TC]);
        expect(supportedTargetFormats(() => false)).toEqual([]);
    });
});

describe('TextureFormatLog', () => {
    it('counts the payloads that lost their compression apart from the ones that kept it', () => {
        const log = new TextureFormatLog();
        log.record('a.ktx2:n', compressedUploadDecision(ASTC, true));
        log.record('b.ktx2:n', compressedUploadDecision(null, false));
        log.record('c.ktx2:n', compressedUploadDecision(ETC2, false));
        log.record('d.png:n', RAW_PAYLOAD_UPLOAD);

        const r = log.report([ASTC], true);
        expect(r.compressed).toBe(1);
        expect(r.decoded).toBe(2);
        // A source image is neither: it never had compression to lose, and
        // counting it as decoded would make every uncompressed project look sick.
        expect(r.textures).toHaveLength(4);
        expect(r.deviceFormats).toEqual([ASTC]);
        expect(r.deviceProbed).toBe(true);
    });

    it('a texture revived under the same key is one row, not two', () => {
        const log = new TextureFormatLog();
        log.record('a.ktx2:n', compressedUploadDecision(ASTC, true));
        log.record('a.ktx2:n', compressedUploadDecision(ASTC, true));
        expect(log.report([], false).textures).toHaveLength(1);
    });

    it('nobody asked yet is not the same fact as "this device supports none"', () => {
        const unprobed = new TextureFormatLog().report([], false);
        expect(unprobed.deviceFormats).toEqual([]);
        expect(unprobed.deviceProbed).toBe(false);
    });

    it('answers per ASSET PATH, which is the question an inspector asks', () => {
        // The rows are keyed by residency key (path + flip); a caller holding a
        // plain path must not have to know that shape to look one up.
        const log = new TextureFormatLog();
        log.record('t/a.ktx2:n', compressedUploadDecision(null, false));
        const r = log.report([], false);
        expect(textureFormatOf(r, 't/a.ktx2')?.reason).toBe('no-device-format');
        expect(textureFormatOf(r, 't/a')).toBeNull();
        expect(textureFormatOf(null, 't/a.ktx2')).toBeNull();
    });
});
