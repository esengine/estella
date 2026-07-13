// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — merges every per-area catalog into ONE map; `keyof` of the
 *        merge is the typed key union behind t(). New area = new module here +
 *        one spread below. Keys must be globally unique (the spread would
 *        silently last-write-wins otherwise); i18n.test.ts pins that.
 *
 * Translation glossary — keep zh terminology consistent across areas:
 *   Scene 场景 · Entity 实体 · Component 组件 · Asset 资产 · Project 项目 ·
 *   Build 构建 · Play 运行 · Stop 停止 · Viewport 视口 · Outliner 大纲 ·
 *   Details 细节 · Content Browser 内容浏览器 · Output Log 输出日志 ·
 *   Tilemap 瓦片地图 · Tileset 瓦片集 · Tile 瓦片 · Material 材质 ·
 *   Shader 着色器 · Texture 纹理 · Sprite 精灵 · Particle 粒子 ·
 *   Emitter 发射器 · Animation 动画 · Clip 剪辑 · Timeline 时间线 ·
 *   State Machine 状态机 · Behavior Tree 行为树 · Undo 撤销 · Redo 重做 ·
 *   Snap 吸附 · Grid 网格 · Layer 层 · Camera 相机 · Collider 碰撞体 ·
 *   Rigid body 刚体 · Joint 关节 · Prefab 预制体 · Launcher 启动器 ·
 *   Gizmo / UI / Spine / Canvas / Schema stay untranslated (proper nouns).
 */
import { commonMessages } from './common';
import { commandMessages } from './commands';
import { menuMessages } from './menu';
import { settingsMessages } from './settings';

/** Every per-area module, for the uniqueness guard in i18n.test.ts. */
export const messageModules = {
    common: commonMessages,
    commands: commandMessages,
    menu: menuMessages,
    settings: settingsMessages,
} as const;

export const editorMessages = {
    ...commonMessages,
    ...commandMessages,
    ...menuMessages,
    ...settingsMessages,
} as const;
