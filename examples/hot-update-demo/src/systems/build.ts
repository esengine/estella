// Resolves the scene-authored hot-update center once it's loaded, drops the two
// interactive buttons into their slots, and owns the async flows those buttons
// drive. The layout lives in the scene (assets/scenes/main.esscene); this file is
// behavior only — the engine's Assets hot-update API wired to the engine's UI.
import {
    defineSystem, Res, GetWorld,
    UIEvents, Assets,
    Text, UIVisual, UIVisualType,
    spawnUIEntity, createButton, TextAlign,
} from 'esengine';
import type { Entity, World, Color, UIEventQueue, ButtonHandle, TextData, UIVisualData } from 'esengine';

import { COLORS, PACK_GROUP, PACK_TILES, hotUpdateEndpoint, isHeadless } from '../config';
import { state, isBusy } from '../state';

export const buildSystem = defineSystem(
    [Res(UIEvents), Res(Assets), GetWorld()],
    (events: UIEventQueue, assets, world: World) => {
        if (state.built) return;
        const dlcSlot = world.findEntityByName('DlcSlot');
        const primarySlot = world.findEntityByName('PrimarySlot');
        // The whole UI subtree loads atomically; the slots being present means the
        // rest is too. Until then, retry next frame.
        if (dlcSlot === null || primarySlot === null) return;

        const req = (name: string): Entity => world.findEntityByName(name) as Entity;
        state.statusEntity = req('StatusLabel');
        state.planEntity = req('PlanLabel');
        state.pctEntity = req('PctLabel');
        state.versionEntity = req('VersionLabel');
        state.fillEntity = req('ProgressFill');
        state.tiles = PACK_TILES.map((_, i) => req(`Tile${i}`));
        state.tileMarks = PACK_TILES.map((_, i) => req(`TileMark${i}`));
        state.packBound = PACK_TILES.map(() => false);

        // ── Async flows (button-driven; each mutates state, update.ts reflects) ─
        const bind = (tile: Entity, mark: Entity, handle: number): void => {
            if (world.valid(tile) && world.has(tile, UIVisual)) {
                const v = world.get(tile, UIVisual) as UIVisualData;
                v.visualType = UIVisualType.Image;
                v.texture = handle;
                v.color = { r: 1, g: 1, b: 1, a: 1 };
                world.insert(tile, UIVisual, v);
            }
            if (world.valid(mark) && world.has(mark, Text)) {
                const t = world.get(mark, Text) as TextData;
                t.content = '';
                world.insert(mark, Text, t);
            }
        };

        async function startCheck(): Promise<void> {
            if (isBusy(state.phase)) return;
            state.phase = 'checking';
            state.message = '正在检查更新…';
            state.progress = 0;
            state.plan = null;
            const ep = hotUpdateEndpoint();
            try {
                const plan = await assets.checkForUpdate({ manifestUrl: ep.manifestUrl, remoteRoot: ep.remoteRoot });
                if (!plan.hasUpdate) {
                    state.phase = 'up-to-date';
                    state.message = '已是最新版本';
                } else {
                    state.plan = {
                        files: plan.changedAssets.length,
                        bytes: plan.totalBytes,
                        from: plan.fromRevision ?? '—',
                        to: plan.toRevision ?? '—',
                    };
                    state.phase = 'update-found';
                    state.message = '发现新版本';
                }
            } catch {
                // No candidate manifest reachable (e.g. editor Play): honestly "up to date".
                state.phase = 'up-to-date';
                state.message = '已是最新版本（当前为本地内容）';
            }
        }

        async function startApply(): Promise<void> {
            if (state.phase !== 'update-found') return;
            state.phase = 'applying';
            state.message = '正在下载并校验更新…';
            state.progress = 0;
            state.loaded = 0;
            state.total = state.plan?.files ?? 0;
            const res = await assets.applyUpdate((loaded, total) => {
                state.loaded = loaded;
                state.total = total;
                state.progress = total ? loaded / total : 0;
            });
            if (res.ok) {
                state.phase = 'updated';
                state.progress = 1;
                state.message = '更新完成 · 内容已热替换（无需重新发包）';
                state.plan = null;
            } else {
                state.phase = 'update-failed';
                state.message = `更新失败已回滚 · ${res.failed.length} 个文件下载/校验未通过`;
            }
        }

        async function startDownloadPack(): Promise<void> {
            if (isBusy(state.phase)) return;
            state.phase = 'downloading';
            state.message = '正在下载资源包…';
            state.progress = 0;
            state.loaded = 0;
            state.total = PACK_TILES.length;
            await assets.loadGroup(PACK_GROUP, (loaded, total) => {
                state.loaded = loaded;
                state.total = total;
                state.progress = total ? loaded / total : 0;
            });
            for (let i = 0; i < PACK_TILES.length; i++) {
                try {
                    const tex = await assets.loadTexture(PACK_TILES[i]!);
                    bind(state.tiles[i]!, state.tileMarks[i]!, tex.handle);
                    state.packBound[i] = true;
                } catch { /* leave the slot empty */ }
            }
            state.phase = 'downloaded';
            state.progress = 1;
            state.message = '资源包已下载并装载';
        }

        // ── Buttons into the scene's slots (createButton gates onClick on enabled) ─
        state.dlcBtn = button(world, events, dlcSlot, COLORS.control, COLORS.controlHover, COLORS.controlPressed,
            () => { void startDownloadPack(); });
        state.dlcLabel = label(world, state.dlcBtn.entity, '下载资源包', false);

        state.primaryBtn = button(world, events, primarySlot, COLORS.accent, COLORS.accentHover, COLORS.accentPressed,
            () => {
                if (state.phase === 'update-found') void startApply();
                else if (!isBusy(state.phase)) void startCheck();
            });
        state.primaryLabel = label(world, state.primaryBtn.entity, '检查更新', true);

        // Auto-check on boot for a real loading-screen feel — but NOT headless,
        // where the render-verify harness is the sole update driver.
        if (!isHeadless()) void startCheck();

        state.built = true;
    },
    { name: 'HotUpdateBuildSystem' },
);

function button(
    world: World, events: UIEventQueue, slot: Entity,
    normal: Color, hover: Color, pressed: Color, onClick: () => void,
): ButtonHandle {
    return createButton({
        world, events, parent: slot,
        node: { fill: true },
        background: { color: normal },
        states: {
            normal: { color: normal },
            hover: { color: hover },
            pressed: { color: pressed },
            disabled: { color: { ...normal, a: normal.a * 0.5 } },
        },
        onClick,
    });
}

function label(world: World, parent: Entity, content: string, bold: boolean): Entity {
    return spawnUIEntity({
        world, parent,
        node: { fill: true },
        text: { content, fontSize: 15, color: COLORS.text, align: TextAlign.Center, bold },
    });
}
