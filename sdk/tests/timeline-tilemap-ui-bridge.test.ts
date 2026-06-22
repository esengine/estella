/**
 * @file    timeline-tilemap-ui-bridge.test.ts
 * @brief   F2 final batch: tilemap, timeline, and uiHelpers route their WASM
 *          access through the shared CoreApiBridge, so every tilemap_* / _tl_* /
 *          ui_* call inherits the terminal-abort guard. With these three, all
 *          five historical bridge patterns are unified behind WasmBridge.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WasmModuleAborted } from '../src/moduleHealth';
import { CoreApiBridge } from '../src/CoreApiBridge';
import { TilemapAPI, initTilemapAPI, shutdownTilemapAPI } from '../src/tilemap/tilemapAPI';
import { initUIHelpers, setUIRectSizeNative } from '../src/ui/uiHelpers';
import { TimelineApi } from '../src/timeline/TimelineControl';
import type { ESEngineModule, CppRegistry } from '../src/wasm';
import type { Entity } from '../src/types';

function abort(m: object, reason = 'oom'): void {
    (m as { onAbort: (w: unknown) => void }).onAbort(reason);
}

// ---------------------------------------------------------------------------
// tilemap — init-seam routing (module_ becomes the guarded proxy)
// ---------------------------------------------------------------------------
describe('tilemap bridge', () => {
    afterEach(() => shutdownTilemapAPI());

    function makeModule(): ESEngineModule {
        return {
            tilemap_getTile: (_e: number, _x: number, _y: number) => 5,
            tilemap_setVisible: vi.fn(),
            onAbort: undefined,
            _malloc: () => 16,
            _free: vi.fn(),
            HEAPU8: new Uint8Array(64),
        } as unknown as ESEngineModule;
    }

    it('routes tilemap_* through the guard when healthy', () => {
        initTilemapAPI(makeModule());
        expect(TilemapAPI.getTile(0, 0, 0)).toBe(5);
    });

    it('refuses tilemap_* after an abort', () => {
        const m = makeModule();
        initTilemapAPI(m);
        abort(m);
        let caught: unknown;
        try { TilemapAPI.getTile(0, 0, 0); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('tilemap.tilemap_getTile');
    });

    it('falls back once disconnected', () => {
        initTilemapAPI(makeModule());
        shutdownTilemapAPI();
        expect(TilemapAPI.getTile(0, 0, 0)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// uiHelpers — init-seam routing (module_ guarded; registry untouched)
// ---------------------------------------------------------------------------
describe('uiHelpers bridge', () => {
    function makeModule(): ESEngineModule {
        return {
            setUIRectSize: vi.fn(),
            onAbort: undefined,
        } as unknown as ESEngineModule;
    }
    const registry = {} as unknown as CppRegistry;

    it('routes ui calls through the guard when healthy', () => {
        const m = makeModule();
        initUIHelpers(m, registry);
        setUIRectSizeNative(1 as unknown as Entity, 10, 20);
        expect((m as unknown as { setUIRectSize: ReturnType<typeof vi.fn> }).setUIRectSize)
            .toHaveBeenCalledWith(registry, 1, 10, 20);
    });

    it('refuses ui calls after an abort', () => {
        const m = makeModule();
        initUIHelpers(m, registry);
        abort(m);
        let caught: unknown;
        try { setUIRectSizeNative(1 as unknown as Entity, 10, 20); } catch (e) { caught = e; }
        expect(caught).toBeInstanceOf(WasmModuleAborted);
        expect((caught as WasmModuleAborted).context).toBe('uiHelpers.setUIRectSize');
    });
});

// ---------------------------------------------------------------------------
// timeline — the plugin feeds TimelineControl a guarded module; verify the
// control path honours it (the plugin wiring that produces the guarded module
// is covered by typecheck).
// The timeline control path no longer routes through the wasm module — the
// runtime is pure TS now (REARCH_ANIMATION P4c), so there's no `_tl_*` bridge to
// guard. (tilemap + ui bridges above still cover the CoreApiBridge guard.)
