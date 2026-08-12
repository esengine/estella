// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  apiSubsystems.mjs — the tier of each part of Estella, at the size a
 *        creator thinks in.
 *
 * The per-symbol tiers answer "is `AudioSource` frozen". Nobody asks that. They
 * ask "can I build my game's audio on this", and 1462 experimental symbols answer
 * it the same way whether somebody weighed the subsystem or nobody looked at it —
 * which is the exact ambiguity this release removed one level down.
 *
 * So each subsystem carries a verdict and the reason for it. `entry` is what
 * carries the verdict in code: the gate reads their tags out of the snapshots and
 * refuses a table that disagrees with them, so this cannot become a second answer.
 */

/**
 * `tier` is the promise; `why` says what decided it, and is required for anything
 * not frozen — "not frozen" is a decision and has to read like one. Both are
 * published, so both carry a `*Zh`: the Chinese page renders Chinese or it is not
 * a Chinese page.
 */
export const SUBSYSTEMS = [
    {
        id: 'ecs',
        title: 'ECS',
        titleZh: 'ECS',
        tier: 'public',
        entry: ['defineComponent', 'defineSystem', 'Query', 'Mut', 'Res', 'Commands', 'World'],
    },
    {
        id: 'app-lifecycle',
        title: 'App lifecycle',
        titleZh: '应用生命周期',
        tier: 'public',
        entry: ['Schedule', 'addSystemToSchedule', 'addStartupSystem', 'defineSystemSet', 'Time'],
    },
    {
        id: 'transform',
        title: 'Transform & hierarchy',
        titleZh: '变换与层级',
        tier: 'public',
        entry: ['Transform', 'Parent', 'Children', 'Name'],
    },
    {
        id: 'drawing',
        title: 'Sprites & text',
        titleZh: '精灵与文本',
        tier: 'public',
        entry: ['Sprite', 'Text', 'TextAlign'],
    },
    {
        id: 'input',
        title: 'Input actions',
        titleZh: '输入动作',
        tier: 'public',
        why: 'the action and binding vocabulary is frozen; the raw per-frame state under it is Beta — see InputState',
        whyZh: '动作与绑定的词汇表已冻结；它下面的每帧原始状态是 Beta —— 见 InputState',
        entry: ['defineInputMap', 'Button', 'Axis1D', 'Axis2D', 'Key', 'GpButton', 'Stick'],
    },
    {
        id: 'layout-units',
        title: 'Layout units',
        titleZh: '布局单位',
        tier: 'public',
        entry: ['px', 'percent', 'Dimension'],
    },
    {
        id: 'input-raw',
        title: 'Raw input state',
        titleZh: '原始输入状态',
        tier: 'beta',
        why: 'per-frame touch state is reachable only as raw collections, with no accessor for started/ended and no write door — freezing it would freeze both gaps',
        whyZh: '每帧触摸状态只能通过原始集合拿到，started/ended 没有访问器，也没有写入门 —— 冻结它等于把这两个缺口一起冻进去',
        entry: ['Input', 'InputState', 'TouchPoint'],
    },
    {
        id: 'ui',
        title: 'UI',
        titleZh: 'UI',
        tier: 'beta',
        why: 'thirty-three of a hundred and fifteen UI symbols reach a certified game, and the newest part of the surface is the part a creator meets first — anchors, insets, theme tokens',
        whyZh: '115 个 UI 符号里只有 33 个到得了被认证的游戏，而这套面最新的部分恰恰是创作者最先碰的：锚点、inset、主题 token',
        entry: ['UINode', 'UIVisual', 'spawnUIEntity', 'themeColors', 'UICameraInfo'],
    },
    {
        id: 'scene',
        title: 'Scenes',
        titleZh: '场景',
        tier: 'beta',
        why: 'one certified project drives scenes at all, against twenty-six SceneManagerState signatures',
        whyZh: '只有一个被认证的项目在驱动场景，而 SceneManagerState 有 26 个签名',
        entry: ['SceneManager', 'SceneManagerState', 'SceneConfig', 'SceneContext', 'transitionTo'],
    },
    {
        id: 'prefab',
        title: 'Prefabs',
        titleZh: '预制体',
        tier: 'beta',
        why: 'instantiate has not moved, but its result and override shapes are the on-disk format\'s, so the names settled ahead of the shapes',
        whyZh: 'instantiate 没有动过，但它的结果和覆盖形状属于磁盘格式，所以名字比形状先定下来',
        entry: ['Prefabs', 'PrefabServer', 'SpawnOverride'],
    },
    {
        id: 'assets',
        title: 'Assets',
        titleZh: '资产',
        tier: 'beta',
        why: 'one certified project takes Res(Assets), for four of its members, and the host wiring — resolvers, registries, the manifest, device-loss recovery — has to leave the game-facing surface first',
        whyZh: '只有一个被认证的项目用 Res(Assets)，且只用了 4 个成员；而宿主接线（resolver、registry、manifest、设备丢失恢复）必须先离开面向游戏的这一面',
        entry: ['Assets', 'AssetsData'],
    },
    {
        id: 'physics',
        title: 'Physics',
        titleZh: '物理',
        tier: 'beta',
        why: 'the corpus reaches three of thirty-seven physics symbols',
        whyZh: '语料只触到 37 个物理符号里的 3 个',
        entry: ['Physics', 'PhysicsEvents', 'CharacterController'],
    },
    {
        id: 'camera',
        title: 'Camera',
        titleZh: '相机',
        tier: 'beta',
        why: 'clearFlags is a bitmask whose C++ enum has no TypeScript spelling, and cullingMask names layers no exported constant identifies — two fields typed `number` for want of the vocabulary',
        whyZh: 'clearFlags 是位掩码，而它的 C++ enum 在 TypeScript 侧没有拼写；cullingMask 指的图层没有任何导出常量能标识 —— 两个字段被打成 number 是因为缺词汇',
        entry: ['Camera', 'CameraData'],
    },
    {
        id: 'spine',
        title: 'Spine',
        titleZh: 'Spine',
        tier: 'beta',
        why: 'one certified project plays a skeleton; the runtime is a side module a project opts into',
        whyZh: '只有一个被认证的项目在播骨骼；运行时是项目自行选用的 side module',
        entry: ['Spine', 'SpineAnimation'],
    },
    {
        id: 'audio',
        title: 'Audio',
        titleZh: '音频',
        tier: 'beta',
        why: 'a certified run drives a loop and reads the master bus analyser, so a break is noticed — but the corpus reaches a handful of twenty-three audio symbols',
        whyZh: '已有被认证的运行会驱动一个循环并读取 master 总线的 analyser，所以它坏了会被发现——但语料只触到 23 个音频符号里的少数几个',
        entry: ['Audio'],
    },
    {
        id: 'animation',
        title: 'Animation & timeline',
        titleZh: '动画与时间轴',
        tier: 'beta',
        why: 'sprite-animation now certifies it end to end, but the corpus reaches two of eighty animation symbols and the timeline half of them is untouched',
        whyZh: 'sprite-animation 现在端到端认证了它，但语料只触到 80 个动画符号里的 2 个，而其中时间轴那一半完全没被碰过',
        entry: ['Animator', 'SpriteAnimator'],
    },
    {
        id: 'tilemap',
        title: 'Tilemap',
        titleZh: '瓦片地图',
        tier: 'experimental',
        why: 'certified end to end by two games, but the runtime surface has not been read for a tier yet',
        whyZh: '有两个游戏端到端认证了它，但它的运行时面还没有被拿来定级',
        entry: ['TilemapLayer'],
    },
    {
        id: 'particles',
        title: 'Particles',
        titleZh: '粒子',
        tier: 'experimental',
        why: 'as tilemap — exercised by a certified game, not yet read for a tier',
        whyZh: '同瓦片地图 —— 有被认证的游戏在用，但还没被拿来定级',
        entry: ['ParticleEmitter'],
    },
    {
        id: 'video',
        title: 'Video',
        titleZh: '视频',
        tier: 'experimental',
        why: 'the platform paths differ enough that the surface is still converging',
        whyZh: '各平台路径差异仍大，这套面还在收敛',
        entry: ['Video'],
    },
    {
        id: 'ai',
        title: 'AI — navigation, FSM, behaviour trees',
        titleZh: 'AI —— 导航、状态机、行为树',
        tier: 'experimental',
        why: 'deliberately after the rest: 0.50 freezes what a game is built OUT of, and the layers built ON that come once those are settled',
        whyZh: '刻意排在后面：0.50 冻的是「一个游戏由什么构成」，建立在其上的层要等下面这些定下来',
        entry: ['Nav', 'NavAgent', 'StateMachineAgent', 'BehaviorTreeAgent', 'Perception'],
    },
    {
        id: 'networking',
        title: 'Networking & replication',
        titleZh: '网络与状态复制',
        tier: 'experimental',
        why: 'as AI — the high-level layer waits on the layers under it',
        whyZh: '同 AI —— 高层要等它下面的层',
        entry: ['Net', 'Replicated'],
    },
    {
        id: 'rendering',
        title: 'Materials, lighting, post-processing',
        titleZh: '材质、光照、后处理',
        tier: 'experimental',
        why: 'as AI — and the render graph behind it is still moving',
        whyZh: '同 AI —— 而且它背后的 render graph 还在动',
        entry: ['Material', 'Light2D', 'PostProcessStack'],
    },
];
