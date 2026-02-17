import { getNativeFS, THUMBNAIL_CACHE_MAX, THUMBNAIL_SIZE } from './ContentBrowserTypes';

export class ThumbnailCache {
    private cache_ = new Map<string, string>();
    private loading_ = new Set<string>();

    get(path: string): string | undefined {
        return this.cache_.get(path);
    }

    isLoading(path: string): boolean {
        return this.loading_.has(path);
    }

    async load(path: string, onLoaded: () => void): Promise<void> {
        if (this.cache_.has(path) || this.loading_.has(path)) return;

        this.loading_.add(path);

        try {
            const fs = getNativeFS();
            if (!fs) return;

            const data = await fs.readBinaryFile(path);
            if (!data) return;

            const blob = new Blob([data.buffer as ArrayBuffer]);
            const url = URL.createObjectURL(blob);

            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject();
                img.src = url;
            });

            const canvas = document.createElement('canvas');
            canvas.width = THUMBNAIL_SIZE;
            canvas.height = THUMBNAIL_SIZE;
            const ctx = canvas.getContext('2d')!;

            const scale = Math.min(THUMBNAIL_SIZE / img.width, THUMBNAIL_SIZE / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (THUMBNAIL_SIZE - w) / 2;
            const y = (THUMBNAIL_SIZE - h) / 2;

            ctx.drawImage(img, x, y, w, h);

            const dataUrl = canvas.toDataURL('image/png');
            URL.revokeObjectURL(url);

            if (this.cache_.size >= THUMBNAIL_CACHE_MAX) {
                const firstKey = this.cache_.keys().next().value;
                if (firstKey) this.cache_.delete(firstKey);
            }

            this.cache_.set(path, dataUrl);
            onLoaded();
        } catch {
            // ignore load failures
        } finally {
            this.loading_.delete(path);
        }
    }
}
