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
 * `tier` is the promise; `why` says what decided it, required for anything not
 * frozen — "not frozen" is a decision and has to read like one. Both publish, so
 * both carry a `*Zh`. `source` names the `sdk/src/*` a row speaks for, which is
 * what makes the table answerable BACKWARDS; the rest is {@link INFRASTRUCTURE}.
 */
/**
 * Directories under `sdk/src` that carry no creator-facing verdict: the wiring a
 * game runs ON rather than builds WITH. Listed rather than inferred, so adding a
 * subsystem cannot be mistaken for adding plumbing.
 */
export const INFRASTRUCTURE = {
    diagnostics: 'the engine reporting on itself — a census and a stats overlay, read by tooling',
    document: 'document-model diagnostics shared with the editor, not part of a game',
    platform: 'the PlatformAdapter implementations; a game meets these through the subsystems above',
    runtime: 'how an exported project boots — the loader and app factory the pipeline emits',
    sideModules: 'fetching and caching the optional wasm modules the subsystems above sit on',
    util: 'small shared helpers with no subsystem of their own',
    wasm: 'the generated layout and the bridge to the C++ core',
};

export const SUBSYSTEMS = [
    {
        id: 'ecs',
        title: 'ECS',
        titleZh: 'ECS',
        source: ['ecs'],
        tier: 'public',
        entry: ['defineComponent', 'defineSystem', 'Query', 'Mut', 'Res', 'Commands', 'World'],
    },
    {
        id: 'app-lifecycle',
        title: 'App lifecycle',
        titleZh: '应用生命周期',
        source: ['app'],
        tier: 'public',
        entry: ['Schedule', 'addSystemToSchedule', 'addStartupSystem', 'defineSystemSet', 'Time'],
    },
    {
        id: 'transform',
        title: 'Transform & hierarchy',
        titleZh: '变换与层级',
        source: ['ecs'],
        tier: 'public',
        entry: ['Transform', 'Parent', 'Children', 'Name'],
    },
    {
        id: 'drawing',
        title: 'Sprites & text',
        titleZh: '精灵与文本',
        source: ['ecs', 'ui'],
        tier: 'public',
        entry: ['Sprite', 'Text', 'TextAlign'],
    },
    {
        id: 'input',
        title: 'Input actions',
        titleZh: '输入动作',
        source: ['input'],
        tier: 'public',
        why: 'the action and binding vocabulary is frozen; the raw per-frame state under it is Beta — see InputState',
        whyZh: '动作与绑定的词汇表已冻结；它下面的每帧原始状态是 Beta —— 见 InputState',
        entry: ['defineInputMap', 'Button', 'Axis1D', 'Axis2D', 'Key', 'GpButton', 'Stick'],
    },
    {
        id: 'layout-units',
        title: 'Layout units',
        titleZh: '布局单位',
        source: ['ui'],
        tier: 'public',
        entry: ['px', 'percent', 'Dimension'],
    },
    {
        id: 'input-raw',
        title: 'Raw input state',
        titleZh: '原始输入状态',
        source: ['input'],
        tier: 'beta',
        why: 'per-frame touch state is reachable only as raw collections, with no accessor for started/ended and no write door — freezing it would freeze both gaps',
        whyZh: '每帧触摸状态只能通过原始集合拿到，started/ended 没有访问器，也没有写入门 —— 冻结它等于把这两个缺口一起冻进去',
        entry: ['Input', 'InputState', 'TouchPoint'],
    },
    {
        id: 'ui',
        title: 'UI',
        titleZh: 'UI',
        source: ['ui'],
        tier: 'beta',
        why: 'thirty-three of a hundred and fifteen UI symbols reach a certified game, and the newest part of the surface is the part a creator meets first — anchors, insets, theme tokens',
        whyZh: '115 个 UI 符号里只有 33 个到得了被认证的游戏，而这套面最新的部分恰恰是创作者最先碰的：锚点、inset、主题 token',
        entry: ['UINode', 'UIVisual', 'spawnUIEntity', 'themeColors', 'UICameraInfo'],
    },
    {
        id: 'scene',
        title: 'Scenes',
        titleZh: '场景',
        source: ['scene'],
        tier: 'beta',
        why: 'one certified project drives scenes at all, against twenty-six SceneManagerState signatures',
        whyZh: '只有一个被认证的项目在驱动场景，而 SceneManagerState 有 26 个签名',
        entry: ['SceneManager', 'SceneManagerState', 'SceneConfig', 'SceneContext', 'transitionTo'],
    },
    {
        id: 'prefab',
        title: 'Prefabs',
        titleZh: '预制体',
        source: ['prefab'],
        tier: 'beta',
        why: 'instantiate has not moved, but its result and override shapes are the on-disk format\'s, so the names settled ahead of the shapes',
        whyZh: 'instantiate 没有动过，但它的结果和覆盖形状属于磁盘格式，所以名字比形状先定下来',
        entry: ['Prefabs', 'PrefabServer', 'SpawnOverride'],
    },
    {
        id: 'assets',
        title: 'Assets',
        titleZh: '资产',
        source: ['asset'],
        tier: 'beta',
        why: 'one certified project takes Res(Assets), for four of its members, and the host wiring — resolvers, registries, the manifest, device-loss recovery — has to leave the game-facing surface first',
        whyZh: '只有一个被认证的项目用 Res(Assets)，且只用了 4 个成员；而宿主接线（resolver、registry、manifest、设备丢失恢复）必须先离开面向游戏的这一面',
        entry: ['Assets', 'AssetsData'],
    },
    {
        id: 'physics',
        title: 'Physics',
        titleZh: '物理',
        source: ['physics'],
        tier: 'beta',
        why: 'the corpus reaches three of thirty-seven physics symbols',
        whyZh: '语料只触到 37 个物理符号里的 3 个',
        entry: ['Physics2D', 'Physics2DEvents', 'CharacterController2D'],
    },
    {
        id: 'camera',
        title: 'Camera',
        titleZh: '相机',
        source: ['camera'],
        tier: 'beta',
        why: 'clearFlags is a bitmask whose C++ enum has no TypeScript spelling, and cullingMask names layers no exported constant identifies — two fields typed `number` for want of the vocabulary',
        whyZh: 'clearFlags 是位掩码，而它的 C++ enum 在 TypeScript 侧没有拼写；cullingMask 指的图层没有任何导出常量能标识 —— 两个字段被打成 number 是因为缺词汇',
        entry: ['Camera', 'CameraData'],
    },
    {
        id: 'spine',
        title: 'Spine',
        titleZh: 'Spine',
        source: ['spine', 'skeletal'],
        tier: 'beta',
        why: 'one certified project plays a skeleton; the runtime is a side module a project opts into',
        whyZh: '只有一个被认证的项目在播骨骼；运行时是项目自行选用的 side module',
        entry: ['Spine', 'SpineAnimation'],
    },
    {
        id: 'audio',
        title: 'Audio',
        titleZh: '音频',
        source: ['audio'],
        tier: 'beta',
        why: 'a certified run drives a loop and reads the master bus analyser, so a break is noticed — but the corpus reaches a handful of twenty-three audio symbols',
        whyZh: '已有被认证的运行会驱动一个循环并读取 master 总线的 analyser，所以它坏了会被发现——但语料只触到 23 个音频符号里的少数几个',
        entry: ['Audio'],
    },
    {
        id: 'animation',
        title: 'Animation & timeline',
        titleZh: '动画与时间轴',
        source: ['animation', 'timeline'],
        tier: 'beta',
        why: 'sprite-animation now certifies it end to end, but the corpus reaches two of eighty animation symbols and the timeline half of them is untouched',
        whyZh: 'sprite-animation 现在端到端认证了它，但语料只触到 80 个动画符号里的 2 个，而其中时间轴那一半完全没被碰过',
        entry: ['Animator', 'SpriteAnimator'],
    },
    {
        id: 'tilemap',
        title: 'Tilemap',
        titleZh: '瓦片地图',
        source: ['tilemap'],
        tier: 'beta',
        why: 'two games certify it and one of them runs on every change, which is broader evidence than '
            + 'several rows already at this tier; what is not settled is the multi-tileset layer, '
            + 'whose singular field is still carried for older scenes',
        whyZh: '两个游戏认证了它，其中一个每次改动都跑 —— 这比几个已经在这一级的子系统证据还多；'
            + '还没定下来的是多 tileset 的图层，单数字段仍为旧场景保留着',
        entry: ['TilemapLayer'],
    },
    {
        id: 'particles',
        title: 'Particles',
        titleZh: '粒子',
        source: ['particle', 'trail'],
        tier: 'beta',
        why: 'one certified game drives it, the same evidence spine and scene were published on; '
            + 'the authored curves are the young half — they override the start/end pairs, and only '
            + 'one game has authored any',
        whyZh: '有一个被认证的游戏在驱动它，与 spine、scene 当初发布时的证据同级；'
            + '年轻的那一半是可编辑曲线 —— 它们会覆盖 start/end，而只有一个游戏真的编过',
        entry: ['ParticleEmitter'],
    },
    {
        id: 'video',
        title: 'Video',
        titleZh: '视频',
        source: ['video'],
        tier: 'experimental',
        why: 'the platform paths differ enough that the surface is still converging',
        whyZh: '各平台路径差异仍大，这套面还在收敛',
        entry: ['Video'],
    },
    {
        id: 'ai',
        title: 'AI — navigation, FSM, behaviour trees',
        titleZh: 'AI —— 导航、状态机、行为树',
        source: ['ai'],
        tier: 'experimental',
        why: 'deliberately after the rest: 0.50 freezes what a game is built OUT of, and the layers built ON that come once those are settled',
        whyZh: '刻意排在后面：0.50 冻的是「一个游戏由什么构成」，建立在其上的层要等下面这些定下来',
        entry: ['Nav', 'NavAgent', 'StateMachineAgent', 'BehaviorTreeAgent', 'Perception'],
    },
    {
        id: 'networking',
        title: 'Networking & replication',
        titleZh: '网络与状态复制',
        source: ['net'],
        tier: 'experimental',
        why: 'as AI — the high-level layer waits on the layers under it',
        whyZh: '同 AI —— 高层要等它下面的层',
        entry: ['Net', 'Replicated'],
    },
    {
        id: 'rendering',
        title: 'Materials, lighting, post-processing',
        titleZh: '材质、光照、后处理',
        source: ['render', 'postprocess'],
        tier: 'experimental',
        why: 'as AI — a game is built OUT of the layers under this one and they freeze first; '
            + 'the render graph it was waiting on has settled',
        whyZh: '同 AI —— 一个游戏是由它下面那几层构成的,那些先冻;它当初等的那个 render graph 已经定下来了',
        entry: ['Material', 'Light', 'PostProcessStack'],
    },
    {
        id: 'physics-3d',
        title: '3D physics',
        titleZh: '3D 物理',
        source: ['physics3d'],
        tier: 'experimental',
        why: 'its door — the plugin, the world resource, the contact events — reached no entry until this release, so nothing has yet built on the half a game actually calls',
        whyZh: '它的门（插件、世界资源、碰撞事件）到这个版本才第一次进入口，所以游戏真正会调用的那一半还没有被任何东西建立在上面',
        entry: ['RigidBody3D', 'Physics3D', 'Physics3DPlugin', 'CharacterController3D'],
    },
    {
        id: 'mesh',
        title: '3D models & skinning',
        titleZh: '3D 模型与蒙皮',
        source: ['render'],
        tier: 'experimental',
        why: 'the import chain is certified end to end, but the runtime surface a game drives a model through — geometry, materials per submesh, joint entities — has not been read for a tier',
        whyZh: '导入链路已经端到端认证，但游戏用来驱动模型的运行时面（几何体、逐子网格材质、关节实体）还没有被拿来定级',
        entry: ['MeshRenderer', 'MeshRendererAPI', 'MeshRenderers'],
    },
    {
        id: 'dragonbones',
        title: 'DragonBones',
        titleZh: 'DragonBones',
        source: ['dragonbones'],
        tier: 'experimental',
        why: 'the second 2D skeletal runtime, and the one no certified game animates with — Spine carries that evidence and this shares none of it',
        whyZh: '第二个 2D 骨骼运行时，也是没有任何被认证的游戏在用的那个 —— 证据在 Spine 那边，这边一点也没分到',
        entry: ['DragonBonesAnimation', 'DragonBonesPlugin'],
    },
    {
        id: 'math',
        title: 'Math',
        titleZh: '数学库',
        source: ['math'],
        tier: 'experimental',
        why: 'the TYPES are frozen — Vec2, Vec3, Quat are @public and a Transform is made of them — but the operations over them are not, and a verdict has to name the weaker half',
        whyZh: '类型本身已冻结 —— Vec2、Vec3、Quat 是 @public，Transform 就是由它们构成的 —— 但它们之上的运算没有，而判决必须按更弱的那一半来说',
        entry: ['vec2', 'vec3', 'quat'],
    },
    {
        id: 'i18n',
        title: 'Localization',
        titleZh: '本地化',
        source: ['i18n'],
        tier: 'experimental',
        why: 'certified end to end by one game, whose use is a locale and a key lookup; the plural, formatting and fallback surface around that has no consumer',
        whyZh: '有一个游戏端到端认证了它，但用到的只是「切语言 + 查 key」；围绕它的复数、格式化、回退这一圈没有任何消费者',
        entry: ['Localization', 'LocalizationAPI', 'LocalizationPlugin'],
    },
    {
        id: 'services',
        title: 'Platform services',
        titleZh: '平台服务',
        source: ['services'],
        tier: 'experimental',
        why: 'each service is a contract with a store rather than with the engine, and the ones behind it differ enough that the shared shape is still being found',
        whyZh: '每个服务都是与某个平台的契约而非与引擎的契约，而它们之间的差异大到共同形状还没找出来',
        entry: ['Ads', 'Achievements', 'Identity'],
    },
];
