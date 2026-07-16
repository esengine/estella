// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  tile.ts — Tilemap painter + Tileset editor: palette, brushes, layers, animation UI.
 */
import { defineMessages } from './types';

export const tileMessages = defineMessages({
    // — Painter paint tools (button tooltips; the shortcut letter is appended in code) —
    'tile.tool.brush': { en: 'Brush (Alt eyedrops)', zh: '笔刷（Alt 取色）' },
    'tile.tool.eraser': { en: 'Eraser', zh: '橡皮擦' },
    'tile.tool.rect': { en: 'Rect (Shift square · Alt hollow)', zh: '矩形（Shift 正方 · Alt 空心）' },
    'tile.tool.ellipse': { en: 'Ellipse (Shift circle · Alt hollow)', zh: '椭圆（Shift 正圆 · Alt 空心）' },
    'tile.tool.line': { en: 'Line (Shift 45°)', zh: '直线（Shift 45°）' },
    'tile.tool.bucket': { en: 'Bucket', zh: '填充' },
    'tile.tool.select': { en: 'Select ({mod}C/X/V copy/cut/paste · drag inside to move)', zh: '选择（{mod}C/X/V 复制/剪切/粘贴 · 选区内拖动=移动）' },
    'tile.tool.eyedropper': { en: 'Eyedropper', zh: '取色器' },
    'tile.tool.terrain': { en: 'Terrain', zh: '地形' },
    'tile.tool.exit': { en: 'Select / transform (Q · Esc to exit painting)', zh: '选择 / 变换（Q · Esc 退出绘制）' },
    'tile.flipH': { en: 'Flip horizontal (H)', zh: '水平翻转（H）' },
    'tile.flipV': { en: 'Flip vertical (V)', zh: '垂直翻转（V）' },
    'tile.rotate': { en: 'Rotate 90° (R)', zh: '旋转 90°（R）' },
    'tile.randomTip': {
        en: 'Random: each painted cell samples one tile from the selection (weighted by tile probability)',
        zh: '随机：每个绘制的单元格从选区中随机取一块瓦片（按瓦片概率加权）',
    },
    'tile.terrainBrush': { en: 'Terrain brush', zh: '地形笔刷' },

    // — Saved-stamp library —
    'tile.saveStamp': { en: 'Save the current brush as a stamp', zh: '将当前笔刷保存为图章' },
    'tile.recallStamp': { en: '{name} ({w}×{h}) — click to use as brush', zh: '{name}（{w}×{h}）— 点击用作笔刷' },
    'tile.deleteStamp': { en: 'Delete stamp', zh: '删除图章' },
    'tile.stampsEmpty': { en: 'No saved stamps — pick a pattern, then save it here', zh: '暂无图章 — 选好图案后在此保存' },

    // — Painter layer strip —
    'tile.newLayerTip': { en: 'New layer on this tileset', zh: '在此瓦片集上新建层' },
    'tile.layerRename': { en: 'Rename', zh: '重命名' },
    'tile.layerDuplicate': { en: 'Duplicate layer', zh: '复制层' },
    'tile.layerMoveUp': { en: 'Move up', zh: '上移' },
    'tile.layerMoveDown': { en: 'Move down', zh: '下移' },
    'tile.layerDelete': { en: 'Delete layer', zh: '删除层' },
    'tile.show': { en: 'Show', zh: '显示' },
    'tile.hide': { en: 'Hide', zh: '隐藏' },
    'tile.paintOn': { en: 'Paint on "{name}"', zh: '在“{name}”上绘制' },
    'tile.opacityPct': { en: 'Opacity {pct}%', zh: '不透明度 {pct}%' },
    'tile.lock': { en: 'Lock', zh: '锁定' },
    'tile.unlock': { en: 'Unlock', zh: '解锁' },

    // — Painter tileset tabs —
    'tile.tilesetN': { en: 'Tileset {n}', zh: '瓦片集 {n}' },
    'tile.tilesetGid': { en: '{path}  (gid {gid}+)', zh: '{path}（gid {gid}+）' },
    'tile.addTileset': { en: 'Add tileset', zh: '添加瓦片集' },
    'tile.removeTileset': { en: 'Remove tileset', zh: '移除瓦片集' },
    'tile.noTilesetsToAdd': { en: 'No tilesets to add', zh: '没有可添加的瓦片集' },

    // — Painter palette + zoom bar —
    'tile.zoomIn': { en: 'Zoom in', zh: '放大' },
    'tile.zoomOut': { en: 'Zoom out', zh: '缩小' },
    'tile.fitWidth': { en: 'Fit width', zh: '适配宽度' },
    'tile.paletteAria': { en: 'Tile palette', zh: '瓦片调色板' },
    'tile.noPalette': {
        en: 'No palette (the tilemap references no .estileset)',
        zh: '没有调色板（该瓦片地图未引用任何 .estileset）',
    },
    'tile.noTerrains': {
        en: "No terrains (create and tag tiles in the Tileset Editor's Terrain mode)",
        zh: '没有地形（在瓦片集编辑器的地形模式中创建并标记瓦片）',
    },

    // — Painter palette-cell badges —
    'tile.badgeCollision': { en: 'Has collision', zh: '有碰撞' },
    'tile.badgeTerrain': { en: 'Terrain member', zh: '地形成员' },
    'tile.badgeAnimated': { en: 'Animated', zh: '有动画' },

    // — Painter empty state —
    'tile.noTilemap': { en: 'No tilemap selected', zh: '未选中瓦片地图' },
    'tile.noTilemapHint': {
        en: 'Right-click an .estileset in the Content Browser → Create Tilemap, or select a tilemap entity in the Outliner',
        zh: '在内容浏览器中右键一个 .estileset → 创建瓦片地图，或在大纲中选中一个瓦片地图实体',
    },

    // — Tileset editor: toolbar fields + modes —
    'tile.field.tileW': { en: 'Tile W', zh: '瓦片宽' },
    'tile.field.tileH': { en: 'Tile H', zh: '瓦片高' },
    'tile.field.margin': { en: 'Margin', zh: '边距' },
    'tile.field.spacing': { en: 'Spacing', zh: '间距' },
    'tile.field.zoom': { en: 'Zoom', zh: '缩放' },
    'tile.mode.aria': { en: 'Edit mode', zh: '编辑模式' },
    'tile.mode.collision': { en: 'Collision', zh: '碰撞' },
    'tile.mode.terrain': { en: 'Terrain', zh: '地形' },
    'tile.mode.animation': { en: 'Animation', zh: '动画' },
    'tile.mode.properties': { en: 'Properties', zh: '属性' },
    'tile.shape.aria': { en: 'Collision shape', zh: '碰撞形状' },
    'tile.shape.box': { en: 'Box', zh: '矩形' },
    'tile.shape.polygon': { en: 'Polygon', zh: '多边形' },
    'tile.shape.circle': { en: 'Circle', zh: '圆形' },
    'tile.modifiers': { en: 'Modifiers', zh: '修饰' },
    'tile.oneWay': { en: 'One-way', zh: '单向' },
    'tile.oneWayTip': { en: 'One-way platform: painted collision is solid on top, pass-through from below', zh: '单向平台：所画碰撞上方实心、下方可穿过' },
    'tile.sensor': { en: 'Sensor', zh: '触发器' },
    'tile.sensorTip': { en: 'Sensor: painted collision is a non-solid trigger (fires events, no physical response)', zh: '触发器：所画碰撞为非实心触发（触发事件、无物理响应）' },
    'tile.friction': { en: 'friction', zh: '摩擦' },
    'tile.restitution': { en: 'bounce', zh: '弹性' },
    'tile.density': { en: 'density', zh: '密度' },
    'tile.cell.circleTip': { en: 'Tile #{id} — drag paints fitted circle colliders (start on a circled tile to clear)', zh: '瓦片 #{id}——拖动铺设圆形碰撞（从已有圆形的瓦片起拖则清除）' },
    'tile.cell.propTip': { en: 'Tile #{id} — click to edit its custom properties', zh: '瓦片 #{id}——点击编辑自定义属性' },
    'tile.prop.pickHint': { en: 'Click a tile to edit its custom key/value properties.', zh: '点击一个瓦片以编辑它的自定义键值属性。' },
    'tile.prop.probability': { en: 'probability', zh: '概率' },
    'tile.prop.probabilityTip': {
      en: 'Random-brush weight (default 1; 0 = never scattered)',
      zh: '随机刷权重（默认 1；0 = 永不散布）',
    },
    'tile.prop.key': { en: 'key', zh: '键' },
    'tile.prop.value': { en: 'value', zh: '值' },
    'tile.prop.add': { en: 'Add property', zh: '添加属性' },
    'tile.prop.remove': { en: 'Remove property', zh: '移除属性' },
    // Slope / half-tile presets (polygon mode): pick one, then click tiles to stamp it.
    'tile.slope.presets': { en: 'Presets', zh: '预设' },
    'tile.slope.freeform': { en: 'Custom…', zh: '自定义…' },
    'tile.slope.stampTip': { en: 'Click a tile to stamp “{name}”', zh: '点瓦片盖上“{name}”' },
    'tile.slope.rampR': { en: 'Ramp ◢ (up →)', zh: '斜坡 ◢（向右升）' },
    'tile.slope.rampL': { en: 'Ramp ◣ (up ←)', zh: '斜坡 ◣（向左升）' },
    'tile.slope.halfBottom': { en: 'Half (bottom)', zh: '半砖（下）' },
    'tile.slope.halfTop': { en: 'Half (top)', zh: '半砖（上）' },
    'tile.slope.halfLeft': { en: 'Half (left)', zh: '半砖（左）' },
    'tile.slope.halfRight': { en: 'Half (right)', zh: '半砖（右）' },
    'tile.solidCount': { en: '{count} solid', zh: '{count} 个实心' },
    'tile.save': { en: 'Save', zh: '保存' },
    'tile.done': { en: 'Done', zh: '完成' },

    // — Tileset editor: empty state + canvas warning —
    'tile.noOpen': { en: 'No tileset open', zh: '未打开瓦片集' },
    'tile.noOpenHint': {
        en: 'Double-click an .estileset in the Content Browser, or right-click a texture → Create Tileset',
        zh: '在内容浏览器中双击一个 .estileset，或右键一张纹理 → 创建瓦片集',
    },
    'tile.texNotFound': { en: 'Texture not found (ref {ref})', zh: '未找到纹理（引用 {ref}）' },
    'tile.refEmpty': { en: 'empty', zh: '空' },

    // — Tileset editor: collision cells + polygon editor —
    'tile.cell.polyTip': { en: '#{id} — click to edit collision polygon', zh: '#{id}——点击编辑碰撞多边形' },
    'tile.pe.title': { en: 'Collision polygon · #{id}', zh: '碰撞多边形 · #{id}' },
    'tile.pe.clear': { en: 'Clear', zh: '清除' },
    'tile.pe.hint': {
        en: 'Click to add a vertex · click a vertex to delete · takes effect at ≥3 points',
        zh: '点击添加顶点 · 点击顶点以删除 · ≥3 个顶点时生效',
    },

    // — Tileset editor: terrain authoring —
    'tile.zone.member': { en: 'Tile belongs to this terrain', zh: '瓦片属于此地形' },
    'tile.zone.aria': { en: '{dir} peering zone', zh: '{dir}邻接区域' },
    'tile.zone.peerTip': { en: 'Peer with the {dir} neighbor', zh: '与{dir}方向的邻居相接' },
    'tile.dir.north': { en: 'north', zh: '北' },
    'tile.dir.northEast': { en: 'north-east', zh: '东北' },
    'tile.dir.east': { en: 'east', zh: '东' },
    'tile.dir.southEast': { en: 'south-east', zh: '东南' },
    'tile.dir.south': { en: 'south', zh: '南' },
    'tile.dir.southWest': { en: 'south-west', zh: '西南' },
    'tile.dir.west': { en: 'west', zh: '西' },
    'tile.dir.northWest': { en: 'north-west', zh: '西北' },
    'tile.terrain.edgeShort': { en: 'Edge', zh: '边' },
    'tile.terrain.cornerShort': { en: 'Corner', zh: '角' },
    'tile.terrain.new': { en: 'New terrain', zh: '新建地形' },
    'tile.terrain.modeAria': { en: 'Terrain mode', zh: '地形模式' },
    'tile.terrain.edge4': { en: 'Edge (4-bit)', zh: '边（4 位）' },
    'tile.terrain.cornerBlob': { en: 'Corner (blob)', zh: '角（blob）' },
    'tile.terrain.delete': { en: 'Delete terrain', zh: '删除地形' },

    // — Tileset editor: animation authoring —
    'tile.anim.pickHint': {
        en: 'Click a tile in the atlas to edit its animation — animated tiles carry a ▶ mark',
        zh: '在图集中点击一块瓦片以编辑其动画——有动画的瓦片带 ▶ 标记',
    },
    'tile.cell.animEditTip': { en: '#{id} — click to edit its animation', zh: '#{id}——点击编辑其动画' },
    'tile.cell.animAppendTip': { en: '#{id} — click to append as a frame', zh: '#{id}——点击追加为一帧' },
    'tile.anim.durTip': { en: 'Frame duration (ms)', zh: '帧时长（毫秒）' },
    'tile.anim.removeFrame': { en: 'Remove frame', zh: '移除帧' },
    'tile.anim.addFrames': { en: 'Click atlas tiles to add frames', zh: '点击图集瓦片以添加帧' },
    'tile.anim.appendFrames': { en: 'Click atlas tiles to append frames', zh: '点击图集瓦片以追加帧' },
    'tile.anim.clear': { en: 'Clear animation', zh: '清除动画' },
    'tile.preview': { en: 'Preview', zh: '预览' },

    // — New-Tilemap picker dialog —
    'tile.pick.hint': { en: "Pick a tileset to use as the map's palette", zh: '选择一个瓦片集作为地图的调色板' },
    'tile.pick.search': { en: 'Search tilesets…', zh: '搜索瓦片集…' },
    'tile.pick.noMatch': { en: 'No matching tilesets', zh: '没有匹配的瓦片集' },

    // — Dock panel title (the Tileset editor tab) —
    'tile.panelTileset': { en: 'Tileset', zh: '瓦片集' },

    // — Toasts —
    'tile.toast.created': {
        en: 'Created tilemap — pick a brush to paint in the viewport',
        zh: '已创建瓦片地图——选择笔刷即可在视口中绘制',
    },
    'tile.toast.untracked': { en: 'Tileset is not tracked by the project', zh: '瓦片集未被项目跟踪' },
    'tile.toast.readFailed': { en: 'Failed to read tileset: {error}', zh: '读取瓦片集失败：{error}' },
    'tile.toast.openFailed': { en: 'Failed to open tileset: {error}', zh: '打开瓦片集失败：{error}' },
    'tile.toast.texUntracked': {
        en: 'Texture is not tracked by the project — cannot create tileset',
        zh: '纹理未被项目跟踪——无法创建瓦片集',
    },
    'tile.toast.createFailed': { en: 'Failed to create tileset: {error}', zh: '创建瓦片集失败：{error}' },
    'tile.toast.createdTileset': { en: 'Created tileset: {name}', zh: '已创建瓦片集：{name}' },
    'tile.toast.saved': { en: 'Tileset saved', zh: '瓦片集已保存' },
    'tile.toast.saveFailed': { en: 'Failed to save tileset: {error}', zh: '保存瓦片集失败：{error}' },
    'tile.toast.bucketCap': {
        en: 'Bucket fill hit the {cap}-cell cap — filled partially',
        zh: '填充达到 {cap} 单元格上限——已部分填充',
    },
});
