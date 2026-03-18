import { describe, it, expect, vi, afterEach } from 'vitest';

describe('WebPlatformAdapter.fileExists', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return true when server responds 200', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            body: { cancel: vi.fn() },
        } as unknown as Response);

        const { webAdapter } = await import('../src/platform/web');
        expect(await webAdapter.fileExists('/exists.json')).toBe(true);
    });

    it('should return false when server responds 404', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: false,
            body: { cancel: vi.fn() },
        } as unknown as Response);

        const { webAdapter } = await import('../src/platform/web');
        expect(await webAdapter.fileExists('/missing.json')).toBe(false);
    });

    it('should return false when fetch throws a network error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'));

        const { webAdapter } = await import('../src/platform/web');
        expect(await webAdapter.fileExists('/unreachable.json')).toBe(false);
    });

    it('should use GET method instead of HEAD', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            body: { cancel: vi.fn() },
        } as unknown as Response);

        const { webAdapter } = await import('../src/platform/web');
        await webAdapter.fileExists('/test.json');

        const callArgs = fetchSpy.mock.calls[0];
        expect(callArgs[0]).toBe('/test.json');
        expect(callArgs[1]).toBeUndefined();
    });

    it('should cancel response body to avoid downloading content', async () => {
        const cancelFn = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            body: { cancel: cancelFn },
        } as unknown as Response);

        const { webAdapter } = await import('../src/platform/web');
        await webAdapter.fileExists('/large-file.bin');

        expect(cancelFn).toHaveBeenCalled();
    });

    it('should handle null body gracefully', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            body: null,
        } as unknown as Response);

        const { webAdapter } = await import('../src/platform/web');
        expect(await webAdapter.fileExists('/no-body.json')).toBe(true);
    });
});
