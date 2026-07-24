// Reflects demo state → widgets every frame. Pure read of `state`, guarded
// writes (skip when unchanged) so there's no per-frame component churn. This is
// the only place that touches the widgets after build — the async flows only
// ever mutate plain data.
import { defineSystem, GetWorld, Text, UIVisual } from 'esengine';
import type { Entity, World, Color, TextData, UIVisualData } from 'esengine';

import { COLORS } from '../config';
import { state, isBusy } from '../state';

export const updateSystem = defineSystem(
    [GetWorld()],
    (world: World) => {
        if (!state.built) return;

        setText(world, state.versionEntity, '远程内容 · CDN', COLORS.muted);
        setText(world, state.statusEntity, state.message, statusColor());
        setText(world, state.planEntity, planLine(), COLORS.muted);
        setText(world, state.pctEntity, `${Math.round(state.progress * 100)}%`, COLORS.muted);
        setFill(world, state.fillEntity, state.progress);

        setText(world, state.primaryLabel, primaryLabel(), COLORS.text);
        setText(world, state.dlcLabel, state.phase === 'downloading' ? '下载中…' : '下载资源包', COLORS.text);

        const busy = isBusy(state.phase);
        state.primaryBtn?.setDisabled(busy);
        state.dlcBtn?.setDisabled(busy);
    },
    { name: 'HotUpdateReflectSystem' },
);

function statusColor(): Color {
    switch (state.phase) {
        case 'up-to-date':
        case 'updated':
        case 'downloaded':
            return COLORS.ok;
        case 'update-failed':
            return COLORS.warn;
        default:
            return COLORS.text;
    }
}

function primaryLabel(): string {
    switch (state.phase) {
        case 'checking': return '检查中…';
        case 'update-found': return '下载并更新';
        case 'applying': return '更新中…';
        default: return '检查更新';
    }
}

function planLine(): string {
    switch (state.phase) {
        case 'checking':
            return '正在比对远程清单…';
        case 'update-found': {
            const p = state.plan;
            return p ? `${p.files} 个文件 · ${humanBytes(p.bytes)} · rev ${short(p.from)} → ${short(p.to)}` : '';
        }
        case 'applying':
            return `已下载并校验 ${state.loaded}/${state.total} 个文件`;
        case 'updated':
            return '已切换到新版本内容（现有贴图句柄已就地重绑）';
        case 'downloading':
            return `已下载 ${state.loaded}/${state.total} 个资源`;
        case 'downloaded':
            return `已装载 ${state.packBound.filter(Boolean).length}/${state.packBound.length} 个资源`;
        case 'up-to-date':
            return '远程清单与本地内容一致';
        default:
            return '点击「检查更新」比对远程内容，或「下载资源包」按需拉取';
    }
}

function humanBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function short(rev: string): string {
    return rev.length > 8 ? rev.slice(0, 7) : rev;
}

function setText(world: World, entity: Entity, content: string, color: Color): void {
    if (!world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    const sameColor = t.color.r === color.r && t.color.g === color.g && t.color.b === color.b && t.color.a === color.a;
    if (t.content === content && sameColor) return;
    t.content = content;
    t.color = { ...color };
    world.insert(entity, Text, t);
}

function setFill(world: World, entity: Entity, amount: number): void {
    if (!world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    const next = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    if (v.fillAmount === next) return;
    v.fillAmount = next;
    world.insert(entity, UIVisual, v);
}
