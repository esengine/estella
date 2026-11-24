// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bindingFile, bindingRecord } from '../manifestBinding';
import type { AssetLoader, LoadContext, TextureResult } from '../AssetLoader';
import { linearColorSpace, samplesAsSrgb } from '../../ecs/env';
import { platformCreateImage } from '../../platform/base';
import type { ImageLoadResult, PlatformImage } from '../../platform/types';
import { fitImagePixels } from '../../platform/imagePixels';
import { decodeBlobBitmap, decodeImageBitmap, fetchImageBitmap, readImagePixels, shrinkBitmap } from '../imageDecode';
import { evictTextureDimensions, requireResourceManager } from '../../wasm/resourceManager';
import { provideTextureContent, withdrawTextureContent, type TextureRefill } from '../../wasm/textureRefill';
import { TextureContent, type CppResourceManager, type ESEngineModule } from '../../wasm';
import { withMalloc } from '../../wasm/wasmScratch';
import {
    isKtx2, isKtx2Path, loadCompressedTexture, levelsFrom, chooseEngineTargetFormat, engineFormatCode,
    compressedUploadDecision, detectCompressedTextureSupport, glInternalFormat,
    supportedTargetFormats, hostUploadDecision, RAW_PAYLOAD_UPLOAD,
    CompressedTextureFormat,
    type BasisTranscoder, type LoadedCompressedTexture, type TextureUploadDecision,
} from '../compressed';
import { TextureFormatLog, type TextureFormatReport } from '../textureFormatReport';
import {
    uploadBoundTextureImage, applyBoundTextureSampling, handOverNewTexture, findWebGL2Context,
} from '../glTextureUpload';
import { createTextureFromPixels, type TextureParams } from '../../runtime/runtimeAssets';
import { isTextureRecipePath, renderTextureRecipe } from '../textureRecipe';

/**
 * Decode a texture ref to raw RGBA pixels on the current platform. Set by a
 * caller that fetches through a channel `TextureLoader`'s URL-based `<img>`
 * decode can't reach — e.g. the runtime scene loader, whose asset providers
 * pre-decode from `estella://` / WeChat package files / inlined data-URLs. When
 * set, non-KTX2 textures upload through this instead of `loadImage(url)`.
 */
export type TexturePixelDecoder = (
    path: string,
    flip: boolean,
    maxEdge?: number,
) => Promise<ImageLoadResult>;

/**
 * Where a host keeps its textures GPU-compressed: the KTX2 for `path`, `'pending'`
 * while it is being made, or null for one that is not. A pending texture is drawn
 * from a preview no larger than {@link TEXTURE_PREVIEW_EDGE}, so art still being
 * compressed is not held in video memory in full.
 */
export type TextureCompressedSource = (path: string) => Promise<Uint8Array | 'pending' | null>;

/** The longest edge a texture waiting for its compressed form is drawn at. */
export const TEXTURE_PREVIEW_EDGE = 1024;
let nextImageRevision = Date.now();

/**
 * Texture import-time settings. Applied when the GL texture is first uploaded,
 * because WebGL sampler state lives on the texture object — the only way to
 * change filter/wrap after the fact is to hold the GL texture id and call
 * `texParameteri`. See {@link TextureLoader#importSettingsResolver}.
 */
export interface TextureImportSettings {
    readonly filter?: 'linear' | 'nearest';
    readonly wrap?: 'repeat' | 'clamp' | 'mirror';
    readonly mipmaps?: boolean;
    /** Whether the image stores sRGB-encoded color (default). Authored-linear
     *  data (normal maps, masks) sets false so the linear pipeline skips the
     *  hardware EOTF. Ignored in gamma mode. */
    readonly srgb?: boolean;
    /**
     * 9-slice border in texture pixels. A property of the IMAGE (where its
     * corners end), not of any one entity — so it is authored once at import
     * and every `UIVisual` set to NineSlice inherits it. Applied to the texture
     * handle's metadata at load; a UIVisual may still override per entity.
     */
    readonly sliceBorder?: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

export type TextureImportSettingsResolver = (ref: string) => TextureImportSettings | undefined;

interface TextureLoadOptions {
    settings?: TextureImportSettings;
    startEdge?: number;
}

/** An asset's settings for the engine's pixel upload: mipmapped unless it says not, as the WebGL upload is. */
function pixelParams(settings: TextureImportSettings | undefined): TextureParams {
    return { filterMode: settings?.filter, wrapMode: settings?.wrap, srgb: settings?.srgb, mipmaps: settings?.mipmaps ?? true };
}

/**
 * Canonical residency key for a texture: the resolved load path plus the
 * flip-orientation flag (flipped and raw uploads are genuinely different GPU
 * objects). The pool also distinguishes independent loaders sharing the device.
 */
export function textureResidencyKey(path: string, flip: boolean): string {
    return `${path}:${flip ? 'f' : 'n'}`;
}

/** @internal Project path and flip as displayed in diagnostics, including for secondary loaders on a device. */
export function logicalTextureKey(poolKey: string): string { return poolKey.replace(/(:[fn]):\d+$/, '$1'); }

type TextureReadContext = Pick<LoadContext, 'backend' | 'catalog' | 'resolveStreamTail' | 'readSharedFile'>;
const primaryTextureOwners = new WeakMap<CppResourceManager, number>();
let nextTextureOwner = 0;

const isPng = (b: Uint8Array): boolean => b.byteLength > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

interface TextureSource {
    readonly handle: number;
    readonly key: string;
    readonly path: string;
    readonly flip: boolean;
    readonly settings?: TextureImportSettings;
    readonly io: TextureReadContext;
    value: TextureResult;
    limited: boolean;
    edge: number;
    fullWidth: number;
    fullHeight: number;
}

interface HeldTextureSource {
    readonly source: TextureSource;
    readonly refill: TextureRefill;
    references: number;
    resize: number;
    pending?: { edge: number; forSurface?: boolean; work: Promise<{ width: number; height: number } | null> };
}

function limitedByRequest(texture: TextureResult, edge: number): boolean {
    if (edge <= 0) return false;
    if (texture.fullWidth !== undefined && texture.fullHeight !== undefined) {
        return texture.width < texture.fullWidth || texture.height < texture.fullHeight;
    }
    return Math.max(texture.width, texture.height) >= edge;
}

export class TextureLoader implements AssetLoader<TextureResult> {
    private readonly owner_ = ++nextTextureOwner;
    private readonly imageRevisions_ = new Map<string, number>();

    /** @internal The first loader on a pool keeps the native host's conventional path. Others own independent entries. */
    poolKey(key: string, rm: CppResourceManager): string {
        const primary = primaryTextureOwners.get(rm);
        if (primary === undefined) primaryTextureOwners.set(rm, this.owner_);
        return primary === undefined || primary === this.owner_ ? key : `${key}:${this.owner_}`;
    }

    /** End this revision for browser image requests and pending residency publications. */
    invalidate(path: string): boolean {
        if (this.detachSource(path)) {
            for (const [handle, held] of this.held_) {
                if (held.source.path === path) this.dropHold_(handle, held);
            }
        }
        return false;
    }

    /** @internal A retired file can still refill its held handles. A new owner of the path loads a fresh generation. */
    detachSource(path: string): boolean {
        this.imageRevisions_.set(path, ++nextImageRevision);
        const flipped = this.sourcesByKey_.delete(textureResidencyKey(path, true));
        const raw = this.sourcesByKey_.delete(textureResidencyKey(path, false));
        return flipped || raw;
    }
    readonly type = 'texture';
    readonly extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ktx2'];

    private module_: ESEngineModule | null;
    /**
     * Basis transcoder for KTX2 assets. Either injected directly via
     * {@link setTranscoder} (tests / embedded realms) or acquired lazily on the
     * first KTX2 load via {@link setTranscoderProvider} — AssetPlugin wires the
     * provider to `app.sideModules.acquire('basis')`, so the basis wasm is only
     * fetched when a project actually uses compressed textures (self-gating, like
     * physics / spine).
     */
    private transcoder_: BasisTranscoder | null = null;
    private transcoderProvider_: (() => Promise<BasisTranscoder | null>) | null = null;
    private transcoderPending_: Promise<BasisTranscoder | null> | null = null;
    setTranscoder(t: BasisTranscoder | null): void { this.transcoder_ = t; }
    setTranscoderProvider(p: (() => Promise<BasisTranscoder | null>) | null): void {
        this.transcoderProvider_ = p;
    }

    /** The transcoder, acquiring it once on demand. Concurrent KTX2 loads share
     *  the in-flight acquisition so the basis module loads exactly once. */
    private async ensureTranscoder_(): Promise<BasisTranscoder | null> {
        if (this.transcoder_) return this.transcoder_;
        if (!this.transcoderProvider_) return null;
        if (!this.transcoderPending_) this.transcoderPending_ = this.transcoderProvider_();
        this.transcoder_ = await this.transcoderPending_;
        return this.transcoder_;
    }
    /**
     * What every texture this loader uploaded became, and the device capability
     * that constrained it. Owned by the loader, so it is scoped to the realm that
     * took the decisions and cannot outlive the textures it describes.
     */
    private readonly formats_ = new TextureFormatLog();
    /** File-backed handles this realm currently owns and can resize. */
    private readonly held_ = new Map<number, HeldTextureSource>();
    private readonly importedReaders_ = new Map<number, number>();
    /** How many loads began smaller than their file (texture streaming), and how many were asked to: a report, and what a check reads. */
    startedSmall = 0;
    askedSmall = 0;
    /** @internal A material only needs a size check after a bounded load or resize was requested. */
    mayHoldReducedTextures = false;
    /** The same sources by residency key, kept past a release: a texture revived from the warm cache is the same file at the size it was left at. */
    private readonly sourcesByKey_ = new Map<string, TextureSource>();
    private deviceFormats_: CompressedTextureFormat[] | null = null;

    /**
     * Optional hook that returns per-asset import settings. Invoked at
     * load-time with the ORIGINAL ref (pre-resolution), so callers can key
     * off `@uuid:...` directly. Undefined-result falls back to defaults.
     */
    importSettingsResolver: TextureImportSettingsResolver | null = null;

    constructor(module: ESEngineModule | null) {
        this.module_ = module;
    }

    /** One-shot options for direct calls that omit their own load options. */
    private pendingOptions_: TextureLoadOptions = {};
    setPendingSettings(settings: TextureImportSettings | undefined): void { this.pendingOptions_.settings = settings; }

    /** Platform pixel decoder (see {@link TexturePixelDecoder}). Null ⇒ the
     *  default URL `<img>` decode path (editor / app Assets, unchanged). */
    private pixelDecoder_: TexturePixelDecoder | null = null;
    setPixelDecoder(decoder: TexturePixelDecoder | null): void { this.pixelDecoder_ = decoder; }
    get pixelDecoder(): TexturePixelDecoder | null { return this.pixelDecoder_; }

    /** Compressed-texture source (see {@link TextureCompressedSource}). */
    private compressedSource_: TextureCompressedSource | null = null;
    setCompressedSource(source: TextureCompressedSource | null): void { this.compressedSource_ = source; }

    load(path: string, ctx: LoadContext | TextureReadContext, options?: TextureLoadOptions): Promise<TextureResult> {
        return this.loadWithFlip(path, ctx, true, options);
    }

    loadRaw(path: string, ctx: LoadContext | TextureReadContext, options?: TextureLoadOptions): Promise<TextureResult> {
        return this.loadWithFlip(path, ctx, false, options);
    }

    async loadFromPixels(
        width: number, height: number, pixels: Uint8Array, flipY: boolean, content: TextureContent, srgb = true,
    ): Promise<TextureResult> {
        const rm = requireResourceManager();
        // A collage of colour images, so colour, unless the caller says its texels are numbers: the engine takes the code as said.
        const format = samplesAsSrgb(srgb) ? 2 : 1;
        // Native (no wasm heap): upload the bytes directly. Web embind lacks this
        // method, so it takes the heap path below unchanged.
        if (rm.createTextureFromBytes) {
            const handle = rm.createTextureFromBytes(width, height, pixels, format, flipY, content);
            return { handle, width, height };
        }
        if (!this.module_) {
            throw new Error('TextureLoader.loadFromPixels: no wasm module and no native byte-upload path');
        }
        const module = this.module_;
        const handle = withMalloc(module, pixels.length, ptr => {
            module.HEAPU8.set(pixels, ptr);
            return rm.createTexture(width, height, ptr, pixels.length, format, flipY, content);
        });
        return { handle, width, height };
    }

    unload(asset: TextureResult): void { this.releaseHandle(asset.handle); }

    /** @internal Give back one native acquisition, including its streaming source. */
    releaseHandle(handle: number): void {
        const held = this.held_.get(handle);
        if (held && --held.references === 0) this.dropHold_(handle, held);
        evictTextureDimensions(handle);
        requireResourceManager().releaseTexture(handle);
    }

    /**
     * Loads the bytes onto the GPU WITHOUT claiming the path — what a re-upload
     * after a device loss wants, since the identity belongs to the handle being
     * recovered. Claiming it leaves the pool holding two records, and the loser
     * is swept up by the next loss with nobody able to re-upload it.
     */
    async loadDetached(
        path: string, ctx: LoadContext | TextureReadContext, flip: boolean, settings?: TextureImportSettings,
    ): Promise<TextureResult> {
        return (await this.decodeAndUpload_(path, ctx, flip, settings)).texture;
    }

    /**
     * Decode the texture behind @p handle again, no larger than @p maxEdge texels on a side (0 is its full size), and move the new
     * pixels behind the handle: everything that holds the handle — a material, a renderer, a batch key — sees the new size at once.
     * The texture streamer's one move. False for a handle this loader did not decode from a file, or one the host cannot re-point.
     */
    async resize(handle: number, maxEdge: number, ctx: TextureReadContext): Promise<{ width: number; height: number } | null> {
        const held = this.held_.get(handle);
        const rm = requireResourceManager();
        if (!held || !rm.adoptTextureContent) return null;
        const { source } = held;
        if (maxEdge > 0 && this.importedReaders_.has(handle)) {
            if (held.pending || source.limited || source.edge > maxEdge) return null;
            return { width: source.value.width, height: source.value.height };
        }
        if (held.pending?.edge === maxEdge) return held.pending.work;
        if (held.pending?.forSurface) return null;
        const request = ++held.resize;
        if (maxEdge > 0) this.mayHoldReducedTextures = true;
        const io = bindingRecord(source.path) === undefined ? ctx : source.io;
        const work = Promise.resolve().then(async () => {
            const { texture: fresh, decision } = await this.decodeAndUpload_(source.path, io, source.flip, source.settings, maxEdge);
            try {
                if (this.held_.get(handle) !== held || held.resize !== request) return null;
                if (!rm.adoptTextureContent?.(handle, fresh.handle)) return null;
                source.fullWidth = fresh.fullWidth ?? fresh.width;
                source.fullHeight = fresh.fullHeight ?? fresh.height;
                source.edge = Math.max(fresh.width, fresh.height);
                source.limited = limitedByRequest(fresh, maxEdge);
                source.value.width = fresh.width;
                source.value.height = fresh.height;
                if (fresh.fullWidth !== undefined) {
                    source.value.fullWidth = fresh.fullWidth;
                    source.value.fullHeight = fresh.fullHeight;
                } else {
                    delete source.value.fullWidth;
                    delete source.value.fullHeight;
                }
                this.recordFormat_(source, decision);
                return { width: fresh.width, height: fresh.height };
            } finally { rm.releaseTexture(fresh.handle); }
        }).finally(() => { if (held.resize === request) held.pending = undefined; });
        held.pending = { edge: maxEdge, work };
        return work;
    }

    /** @internal Finish a full-size reader's preload on the existing handle, including a warm revival or a pending shrink. */
    restoreForSurface(handle: number, ctx: TextureReadContext): Promise<{ width: number; height: number } | null> | undefined {
        const held = this.held_.get(handle);
        if (!held) return;
        if (!held.pending && !held.source.limited) return;
        const work = this.resize(handle, 0, ctx);
        if (held.pending) held.pending.forSurface = true;
        return work;
    }

    /** @internal Background moves wait for uploads already requested by a surface or another caller. */
    isResizing(handle: number): boolean { return !!this.held_.get(handle)?.pending; }

    /** @internal File textures whose readers address imported pixels, with one count per live receipt. */
    get importedSizeReaders(): ReadonlyMap<number, number> { return this.importedReaders_; }

    /** @internal Keep this upload at its imported dimensions for one owner. */
    holdImportedSize(handle: number): (() => void) | undefined {
        const held = this.held_.get(handle);
        if (!held) return;
        this.importedReaders_.set(handle, (this.importedReaders_.get(handle) ?? 0) + 1);
        return () => {
            if (this.held_.get(handle) !== held) return;
            const count = this.importedReaders_.get(handle)!;
            if (count === 1) this.importedReaders_.delete(handle);
            else this.importedReaders_.set(handle, count - 1);
        };
    }

    /** Whether @p handle was decoded from a file by this loader, so it can be decoded again at another size. */
    resizable(handle: number): boolean { return this.held_.has(handle) && !!requireResourceManager().adoptTextureContent; }

    /** @internal Identity of the current hold on a streamable texture. */
    streamingBinding(handle: number): object | undefined { return this.held_.get(handle); }

    *resizableHandles(): IterableIterator<number> {
        if (this.held_.size && requireResourceManager().adoptTextureContent) yield* this.held_.keys();
    }

    /** The size of the file behind @p handle, whatever size it is held at; null for one this loader did not decode from a file. */
    fullSize(handle: number): { width: number; height: number } | null {
        const s = this.held_.get(handle)?.source;
        return s ? { width: s.fullWidth, height: s.fullHeight } : null;
    }

    /** Decode the next load no larger than @p edge on a side (texture streaming's start), where the file's own size can still be known. */
    setPendingStartEdge(edge: number): void { this.pendingOptions_.startEdge = edge; }

    /** A texture the warm cache gave back under @p key is the one this loader decoded under it: resizable again. */
    adoptRevived(handle: number, key: string, value?: TextureResult): void {
        const source = this.sourcesByKey_.get(key);
        if (source?.handle !== handle) return;
        if (value) {
            if (source.edge < Math.max(source.fullWidth, source.fullHeight)) {
                value.fullWidth = source.fullWidth;
                value.fullHeight = source.fullHeight;
            }
            source.value = value;
        }
        this.holdSource_(source);
    }

    private holdSource_(source: TextureSource): void {
        const { handle } = source;
        const held = this.held_.get(handle);
        if (held?.source === source) { held.references++; return; }
        if (held) this.dropHold_(handle, held);
        const refill: TextureRefill = async () => {
            const current = this.held_.get(handle);
            if (current?.refill !== refill) return false;
            const reduced = !this.importedReaders_.has(handle) && !current.pending?.forSurface
                && source.edge < Math.max(source.fullWidth, source.fullHeight);
            const edge = reduced ? source.edge : 0;
            const size = await this.resize(handle, edge, source.io);
            if (size) evictTextureDimensions(handle);
            return size !== null;
        };
        this.held_.set(handle, { source, references: 1, resize: 0, refill });
        provideTextureContent(handle, refill);
    }

    private dropHold_(handle: number, held: HeldTextureSource): void {
        this.held_.delete(handle);
        this.importedReaders_.delete(handle);
        withdrawTextureContent(handle, held.refill);
    }

    private recordFormat_(source: TextureSource, decision: TextureUploadDecision): void {
        if (this.sourcesByKey_.get(source.key) === source) this.formats_.record(source.key, decision, bindingFile(source.key));
    }

    private async loadWithFlip(
        path: string, ctx: TextureReadContext, flip: boolean, options?: TextureLoadOptions,
    ): Promise<TextureResult> {
        const revision = this.imageRevisions_.get(path);
        const { settings, startEdge = 0 } = options ?? this.pendingOptions_;
        if (!options) this.pendingOptions_ = {};
        // A pool that cannot replace content in-place could never restore a streaming preview.
        const start = startEdge > 0 && requireResourceManager().adoptTextureContent ? startEdge : 0;
        if (start > 0) this.mayHoldReducedTextures = true;
        if (startEdge > 0) this.askedSmall++;
        const { texture: result, decision } = await this.decodeAndUpload_(path, ctx, flip, settings, start);
        if (result.fullWidth !== undefined) this.startedSmall++;
        // The original caller still owns its pixels. Only the current revision can publish them by path.
        if (revision !== this.imageRevisions_.get(path)) return result;
        const key = textureResidencyKey(path, flip);
        const source: TextureSource = {
            handle: result.handle, key, path, flip, settings,
            io: { backend: ctx.backend, catalog: ctx.catalog, resolveStreamTail: ctx.resolveStreamTail, readSharedFile: ctx.readSharedFile },
            value: result, limited: limitedByRequest(result, start),
            edge: Math.max(result.width, result.height),
            fullWidth: result.fullWidth ?? result.width, fullHeight: result.fullHeight ?? result.height,
        };
        this.holdSource_(source);
        this.sourcesByKey_.set(key, source);
        this.recordFormat_(source, decision);
        // Path identity in the C++ pool: after the last release the texture can
        // survive as an evictable cache entry (budget permitting) and the next
        // load revives it by this key instead of re-fetching + re-decoding.
        // Optional-chained: minimal test mocks may not model the pool surface.
        const rm = requireResourceManager();
        rm.registerTextureWithPath?.(result.handle, this.poolKey(key, rm));
        return result;
    }

    private async decodeAndUpload_(
        path: string, ctx: TextureReadContext, flip: boolean, settings?: TextureImportSettings, maxEdge = 0,
    ): Promise<{ texture: TextureResult; decision: TextureUploadDecision }> {
        // A build that shipped a small copy beside the file (texture streaming) is read from the copy whenever the size asked for
        // fits in it: the file itself is downloaded only once a view needs more than the copy holds.
        const tail = maxEdge > 0 ? ctx.resolveStreamTail?.(path) ?? ctx.catalog.getStreamTail?.(path) : null;
        const useTail = tail != null && maxEdge <= Math.max(tail.width, tail.height);
        const file = bindingFile(path);
        const buildPath = useTail ? tail.path : ctx.catalog?.getBuildPath(file) ?? file;
        const { decision = RAW_PAYLOAD_UPLOAD, ...texture } = await this.decodeFile_(file, buildPath, ctx, flip, settings, maxEdge, useTail, this.imageRevisions_.get(path));
        if (useTail) {
            texture.fullWidth = tail.fullWidth;
            texture.fullHeight = tail.fullHeight;
        }
        return { texture, decision };
    }

    /** Decode @p path (whose bytes are at @p buildPath; @p copy when that is its small copy) no larger than @p maxEdge, and upload it. */
    private async decodeFile_(
        path: string, buildPath: string, ctx: TextureReadContext, flip: boolean, settings: TextureImportSettings | undefined, maxEdge: number,
        copy: boolean, revision?: number,
    ): Promise<TextureResult & { decision?: TextureUploadDecision }> {
        // A recipe is drawn here, from its source, and is then a texture like any decoded one.
        if (isTextureRecipePath(buildPath)) {
            const drawn = await renderTextureRecipe(path, (p) => ctx.backend.fetchBinary(p === path ? buildPath : ctx.catalog?.getBuildPath(p) ?? p));
            return this.uploadPixels_(drawn, flip, settings, maxEdge);
        }
        if (isKtx2Path(buildPath)) {
            const read = () => ctx.backend.fetchBinary(buildPath);
            const buf = await (ctx.readSharedFile?.(buildPath, 'ktx2', read) ?? read());
            return this.uploadKtx2_(path, new Uint8Array(buf), settings, maxEdge);
        }
        // The host image and compressed-source decoders open the file themselves.
        const ready = ctx.backend?.prepareFile?.(buildPath);
        if (ready) await ready;
        let preview = false;
        if (!copy && this.compressedSource_) {
            const compressed = await this.compressedSource_(path);
            // The source may answer with the image a build ships rather than a KTX2 —
            // a PNG resized or with its clear texels' colour filled in — and it is drawn
            // the way any image is, so the editor shows the pixels the package holds.
            if (compressed instanceof Uint8Array && isPng(compressed)) return this.uploadImageBytes_(compressed, flip, settings, maxEdge);
            if (compressed instanceof Uint8Array) return this.uploadKtx2_(path, compressed, settings, maxEdge);
            preview = compressed === 'pending';
        }
        // The smaller of a preview's edge and the one asked for: a texture held small is decoded small.
        const edge = preview ? (maxEdge > 0 ? Math.min(maxEdge, TEXTURE_PREVIEW_EDGE) : TEXTURE_PREVIEW_EDGE) : maxEdge;
        // A platform pixel decoder (runtime scene loader) pre-decodes to RGBA and
        // uploads through the shared createTexture path — the same code the old
        // runtimeLoader.loadTextures used — instead of a URL-based <img>.
        if (this.pixelDecoder_) {
            // A decoder resolves a logical path itself; a copy is named by where it is.
            const file = copy ? buildPath : path;
            const decoder = this.pixelDecoder_;
            const read = () => decoder(file, flip, edge);
            const variant = `pixels:${flip}:${edge}:${revision ?? 0}`;
            const result = await (ctx.readSharedFile?.(file, variant, read) ?? read());
            return this.uploadPixels_(result, flip, settings, edge);
        }
        const url = ctx.backend.resolveUrl(buildPath);
        const full = { width: 0, height: 0 };
        const img = await this.loadImage(url, flip, edge, copy ? undefined : revision, full);
        return this.uploadSizedImage_(img, full, flip, settings, edge);
    }

    private uploadPixels_(image: ImageLoadResult, flip: boolean, settings: TextureImportSettings | undefined, maxEdge: number): TextureResult {
        const fitted = fitImagePixels(image, maxEdge);
        const handle = createTextureFromPixels(this.module_, fitted, TextureContent.Asset, flip, pixelParams(settings));
        const { width, height, sourceWidth, sourceHeight } = fitted;
        return sourceWidth !== undefined && sourceHeight !== undefined
            ? { handle, width, height, fullWidth: sourceWidth, fullHeight: sourceHeight }
            : { handle, width, height };
    }

    private async uploadImageBytes_(
        bytes: Uint8Array, flip: boolean, settings?: TextureImportSettings, maxEdge = 0,
    ): Promise<TextureResult> {
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
        const full = { width: 0, height: 0 };
        const img = await this.decodeBlob_(blob, flip, maxEdge, full);
        return this.uploadSizedImage_(img, full, flip, settings, maxEdge);
    }

    private uploadSizedImage_(
        img: PlatformImage | ImageBitmap, full: { width: number; height: number }, flip: boolean,
        settings: TextureImportSettings | undefined, maxEdge: number,
    ): TextureResult {
        try {
            const made = this.createTextureFromImage(img, flip, settings, maxEdge);
            return full.width > made.width || full.height > made.height ? { ...made, fullWidth: full.width, fullHeight: full.height } : made;
        } finally {
            if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) img.close();
        }
    }

    private async decodeBlob_(blob: Blob, flip: boolean, maxEdge: number, full: { width: number; height: number }): Promise<PlatformImage | ImageBitmap> {
        const decoded = await decodeBlobBitmap(blob, flip);
        if (decoded) return this.sizedBitmap_(decoded, maxEdge, full);
        const url = URL.createObjectURL(blob);
        try {
            return await this.loadImageElement_(url, url, flip, maxEdge, full);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private sizedBitmap_(bitmap: ImageBitmap, maxEdge: number, full?: { width: number; height: number }): Promise<ImageBitmap> {
        if (full) { full.width = bitmap.width; full.height = bitmap.height; }
        return shrinkBitmap(bitmap, maxEdge);
    }

    /**
     * Upload a KTX2 (Basis) compressed texture: transcode to a device-supported GPU
     * format (or RGBA8 fallback), and upload. KTX2 carries its own orientation, so
     * the `flip` flag does not apply.
     */
    private async uploadKtx2_(
        path: string, bytes: Uint8Array, settings?: TextureImportSettings, maxEdge = 0,
    ): Promise<TextureResult & LoadedCompressedTexture> {
        const made = await this.uploadKtx2Levels_(path, bytes, settings, maxEdge);
        // The header's pixelWidth and pixelHeight (bytes 20 and 24): the file's size, whatever level the upload started at.
        if (bytes.byteLength >= 28) {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const fullWidth = view.getUint32(20, true), fullHeight = view.getUint32(24, true);
            if (fullWidth > made.width || fullHeight > made.height) return { ...made, fullWidth, fullHeight };
        }
        return made;
    }

    private async uploadKtx2Levels_(
        path: string, bytes: Uint8Array, settings?: TextureImportSettings, maxEdge = 0,
    ): Promise<LoadedCompressedTexture> {
        if (!isKtx2(bytes)) throw new Error(`TextureLoader: ${path} is not a KTX2 file`);
        // Native (embedded Dawn): the ResourceManager transcodes the KTX2 with the
        // host's basis library and uploads the compressed blocks — no WebGL2, no
        // wasm transcoder. sRGB follows the texture's settings, as on every path.
        const rm = requireResourceManager();
        if (rm.createTextureFromKTX2) {
            const r = rm.createTextureFromKTX2(bytes, samplesAsSrgb(settings?.srgb));
            if (!r) throw new Error(`TextureLoader: KTX2 transcode failed for ${path}`);
            // A host that reports no format says nothing rather than claiming
            // success: -1 with no block refusal reads as "this device offered
            // none", the honest reading of an absent answer.
            const decision = hostUploadDecision(r.format ?? -1, r.blockRefused ?? false);
            return { handle: r.handle, width: r.width, height: r.height, decision };
        }
        const transcoder = await this.ensureTranscoder_();
        if (!transcoder) {
            throw new Error('TextureLoader: no Basis transcoder available (basis side module missing — KTX2 assets need it)');
        }
        const gl = this.getWebGL2Context();
        if (!gl) {
            // No GL context (the WebGPU backend): ask the ENGINE which format it
            // samples and upload through it. Sampler state is what the GL path
            // below still has and this one does not — here it takes the defaults.
            return this.loadCompressedViaEngine(path, transcoder, bytes, samplesAsSrgb(settings?.srgb), maxEdge);
        }
        // A WebGL2 context implies a wasm module (native has neither, and threw
        // above on the missing gl); the KTX2 path is web-only.
        return loadCompressedTexture(gl, this.module_!, transcoder, bytes,
            { ...settings, srgb: samplesAsSrgb(settings?.srgb), maxEdge });
    }

    /**
     * KTX2 through the engine's own upload, for a backend with no GL context.
     * Falls back to an RGBA decode when no compressed format is available or the
     * transcode to it fails — the same bargain the GL path makes.
     */
    private async loadCompressedViaEngine(
        path: string, transcoder: BasisTranscoder, bytes: Uint8Array, srgb: boolean, maxEdge = 0,
    ): Promise<LoadedCompressedTexture> {
        const rm = requireResourceManager();
        const module = this.module_;
        let target: CompressedTextureFormat | null = null;
        if (module && rm.supportsCompressedFormat && rm.createCompressedTexture) {
            const supports = rm.supportsCompressedFormat.bind(rm);
            target = chooseEngineTargetFormat((code) => supports(code), srgb);
            const whole = target ? await transcoder.transcode(bytes, target) : null;
            const t = whole ? levelsFrom(whole, maxEdge) : null;
            if (target && t) {
                const code = engineFormatCode(target, srgb);
                // Level 0 first, packed, as the device unpacks them, every level of the chain: the device copies each as whole blocks
                // (its physical size), so a level whose side is not a multiple of four is uploaded too. Stopping at the first such level
                // left a 1240x1268 hair atlas with level 0 alone, sampled unfiltered at any distance.
                const levels = t.levels ?? [t];
                const size = levels.reduce((n, l) => n + l.data.length, 0);
                const handle = withMalloc(module, size, (ptr) => {
                    let at = ptr;
                    for (const l of levels) { module.HEAPU8.set(l.data, at); at += l.data.length; }
                    return rm.createCompressedTexture!(t.width, t.height, code, ptr, size, levels.length,
                        TextureContent.Asset);
                });
                if (handle) return { handle, width: t.width, height: t.height, decision: compressedUploadDecision(target, true) };
            }
        }
        const decoded = await transcoder.transcodeToRgba(bytes);
        if (!decoded) throw new Error(`TextureLoader: KTX2 decode failed for ${path}`);
        const rgba = levelsFrom(decoded, maxEdge);
        const texture = await this.loadFromPixels(rgba.width, rgba.height, rgba.data, false, TextureContent.Asset, srgb);
        return { ...texture, decision: compressedUploadDecision(target, false) };
    }

    /**
     * Decode `src` into a GPU-uploadable source. When `createImageBitmap` is
     * available we bake the vertical orientation into the bitmap here via
     * `imageOrientation`, NOT later via `UNPACK_FLIP_Y_WEBGL`: Chromium/ANGLE
     * silently ignore that pixel-store flag for `ImageBitmap` sources, so relying
     * on it uploads every texture upside-down. The raw `<img>` fallback keeps the
     * flag (it works for element/pixel sources) — see {@link createTextureFromImage}.
     */
    private async loadImage(src: string, flip: boolean, maxEdge = 0, revision?: number, full?: { width: number; height: number }): Promise<PlatformImage | ImageBitmap> {
        // A revision is asked for by URL so that an edited file is read again, not served from the cache.
        let url = src;
        if (revision && typeof document !== 'undefined' && !src.startsWith('data:') && !src.startsWith('blob:')) {
            const revised = new URL(src, document.baseURI);
            revised.searchParams.set('_esTextureRevision', String(revision));
            url = revised.href;
        }
        const fetched = await fetchImageBitmap(url, flip);
        if (fetched) return this.sizedBitmap_(fetched, maxEdge, full);
        return this.loadImageElement_(src, url, flip, maxEdge, full);
    }

    private loadImageElement_(src: string, url: string, flip: boolean, maxEdge: number, full?: { width: number; height: number }): Promise<PlatformImage | ImageBitmap> {
        return new Promise((resolve, reject) => {
            const img = platformCreateImage();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (full) { full.width = img.width; full.height = img.height; }
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        resolve(await shrinkBitmap(await decodeImageBitmap(img, flip), maxEdge));
                        return;
                    } catch {
                        // fallback
                    }
                }
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement ? url : src;
        });
    }

    private createTextureFromImage(
        img: PlatformImage | ImageBitmap, flip: boolean, settings?: TextureImportSettings, maxEdge = 0,
    ): TextureResult {
        const { width, height } = img;

        // A bitmap is already oriented by loadImage (imageOrientation); flipping it
        // again at upload would double-flip it. Only raw <img>/pixel sources need
        // the UNPACK_FLIP_Y_WEBGL flip.
        const uploadFlip = (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap)
            ? false : flip;

        const gl = this.getWebGL2Context();
        if (gl && (!(maxEdge > 0) || Math.max(width, height) <= maxEdge)) {
            return this.createTextureWebGL2(gl, img, width, height, uploadFlip, settings);
        }
        // Byte uploads also fit an image element on a host without bitmap resizing.
        return this.uploadPixels_(readImagePixels(img, maxEdge), uploadFlip, settings, maxEdge);
    }

    private getWebGL2Context(): WebGL2RenderingContext | null {
        return findWebGL2Context(this.module_?.GL);
    }

    /**
     * Which compressed formats this device samples, best first.
     *
     * The INPUT to every upload decision, and the half a realm answers without
     * loading one. Null when nothing could be asked — an empty list would read as
     * a capability. Cached, since `getExtension` also ENABLES.
     */
    deviceFormats(): CompressedTextureFormat[] | null {
        if (this.deviceFormats_) return this.deviceFormats_;
        const srgb = linearColorSpace();
        const gl = this.getWebGL2Context();
        if (gl) {
            const support = detectCompressedTextureSupport(gl);
            return (this.deviceFormats_ =
                supportedTargetFormats((f) => glInternalFormat(support, f, srgb) !== null));
        }
        const rm = requireResourceManager();
        if (rm.supportsCompressedFormat) {
            const supports = rm.supportsCompressedFormat.bind(rm);
            return (this.deviceFormats_ =
                supportedTargetFormats((f) => supports(engineFormatCode(f, srgb))));
        }
        return null;
    }

    /** What the textures this loader uploaded became, and on what device. */
    formatReport(): TextureFormatReport {
        const formats = this.deviceFormats();
        return this.formats_.report(formats ?? [], formats !== null);
    }

    private createTextureWebGL2(
        gl: WebGL2RenderingContext,
        img: PlatformImage | ImageBitmap,
        width: number, height: number, flip: boolean,
        settings?: TextureImportSettings,
    ): TextureResult {
        // This path runs only with a live WebGL2 context, which implies a module.
        const handle = handOverNewTexture(this.module_!, gl, (g) => {
            uploadBoundTextureImage(g, img, flip, settings?.srgb);
            applyBoundTextureSampling(g, settings);
        }, { width, height, content: TextureContent.Asset });
        return { handle, width, height };
    }

}

