/**
 * @file    WebAssetProvider.ts
 * @brief   RuntimeAssetProvider for browser-based preview
 */

import type { RuntimeAssetProvider } from '../runtimeLoader';
import type { SceneData } from '../scene';
import { getComponentAssetFieldDescriptors, getComponentSpineFieldDescriptor } from '../scene';
import { getAssetTypeEntry } from '../assetTypes';

export class WebAssetProvider implements RuntimeAssetProvider {
    private textCache_ = new Map<string, string>();
    private binaryCache_ = new Map<string, Uint8Array>();
    private baseUrl_: string;

    constructor(baseUrl: string) {
        this.baseUrl_ = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    }

    async prefetch(sceneData: SceneData): Promise<void> {
        const textRefs = new Set<string>();
        const binaryRefs = new Set<string>();
        const bmfontRefs = new Set<string>();

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                if (!comp.data) continue;
                const spineDesc = getComponentSpineFieldDescriptor(comp.type);
                if (spineDesc) {
                    const skelPath = comp.data[spineDesc.skeletonField] as string;
                    const atlasPath = comp.data[spineDesc.atlasField] as string;
                    if (skelPath) {
                        if (getAssetTypeEntry(skelPath)?.contentType === 'binary') {
                            binaryRefs.add(skelPath);
                        } else {
                            textRefs.add(skelPath);
                        }
                    }
                    if (atlasPath) textRefs.add(atlasPath);
                }
                const descriptors = getComponentAssetFieldDescriptors(comp.type);
                for (const desc of descriptors) {
                    const value = comp.data[desc.field];
                    if (typeof value !== 'string' || !value) continue;
                    if (desc.type === 'font') {
                        bmfontRefs.add(value);
                        textRefs.add(value);
                    } else if (desc.type === 'material') {
                        textRefs.add(value);
                    }
                }
            }
        }

        const fetches: Promise<void>[] = [];

        for (const ref of textRefs) {
            fetches.push(
                fetch(this.resolveUrl(ref))
                    .then(r => r.text())
                    .then(text => { this.textCache_.set(ref, text); })
                    .catch(err => { console.warn(`[WebAssetProvider] Failed to prefetch text "${ref}":`, err); })
            );
        }

        for (const ref of binaryRefs) {
            fetches.push(
                fetch(this.resolveUrl(ref))
                    .then(r => r.arrayBuffer())
                    .then(buf => { this.binaryCache_.set(ref, new Uint8Array(buf)); })
                    .catch(err => { console.warn(`[WebAssetProvider] Failed to prefetch binary "${ref}":`, err); })
            );
        }

        await Promise.all(fetches);

        const fntFetches: Promise<void>[] = [];
        for (const ref of bmfontRefs) {
            const fontEntry = getAssetTypeEntry(ref);
            if (!(fontEntry?.editorType === 'bitmap-font' && fontEntry.contentType === 'json')) continue;
            const text = this.textCache_.get(ref);
            if (!text) continue;
            try {
                const json = JSON.parse(text);
                const fntFile = json.type === 'label-atlas' ? json.generatedFnt : json.fntFile;
                if (fntFile) {
                    const dir = ref.substring(0, ref.lastIndexOf('/'));
                    const fntRef = dir ? `${dir}/${fntFile}` : fntFile;
                    if (!this.textCache_.has(fntRef)) {
                        fntFetches.push(
                            fetch(this.resolveUrl(fntRef))
                                .then(r => r.text())
                                .then(t => { this.textCache_.set(fntRef, t); })
                                .catch(err => { console.warn(`[WebAssetProvider] Failed to prefetch font "${fntRef}":`, err); })
                        );
                    }
                }
            } catch { /* ignore parse errors */ }
        }
        if (fntFetches.length > 0) {
            await Promise.all(fntFetches);
        }
    }

    readText(ref: string): string {
        const cached = this.textCache_.get(ref);
        if (cached !== undefined) return cached;
        throw new Error('Asset not prefetched: ' + ref);
    }

    readBinary(ref: string): Uint8Array {
        const cached = this.binaryCache_.get(ref);
        if (cached !== undefined) return cached;
        throw new Error('Asset not prefetched: ' + ref);
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        const url = this.resolveUrl(ref);
        const resp = await fetch(url);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        bitmap.close();
        return {
            width: imageData.width,
            height: imageData.height,
            pixels: new Uint8Array(imageData.data.buffer),
        };
    }

    resolvePath(ref: string): string {
        return ref;
    }

    private resolveUrl(ref: string): string {
        if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('/')) {
            return ref;
        }
        return this.baseUrl_ + ref;
    }
}
