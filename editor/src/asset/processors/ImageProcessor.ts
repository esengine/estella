import type { AssetProcessor } from '../AssetProcessor';
import type { AssetNode } from '../AssetNode';
import { convertFileSrc } from '@tauri-apps/api/core';

export const imageProcessor: AssetProcessor<HTMLImageElement> = {
    type: 'image',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'],

    async process(node: AssetNode<HTMLImageElement>, projectDir: string): Promise<HTMLImageElement> {
        const absPath = `${projectDir}/${node.path}`;
        const url = `${convertFileSrc(absPath)}?v=${node.version}`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        return new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${node.path}`));
            img.src = url;
        });
    },
};
