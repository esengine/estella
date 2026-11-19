import { spawnUIEntity, createButton, createVirtualButton, createVirtualJoystick, UINode, Text, Name, UIDisplay, px, percent,
    type World, type Entity, type UIEventQueue } from 'esengine';

export const ink = { r: .025, g: .055, b: .085, a: .88 };
export const teal = { r: .46, g: .96, b: .9, a: 1 };
export const gold = { r: .95, g: .78, b: .47, a: 1 };
export const paper = { r: .91, g: .96, b: .96, a: 1 };
export const muted = { r: .59, g: .73, b: .76, a: 1 };
type RGBA = typeof ink;
export interface Actions { enter(): void; lobby(): void; pause(): void; resume(): void; sound(): void; quality(): void }
export function makeUI(world: World, events: UIEventQueue, canvas: Entity, actions: Actions) {
    // Centre the authored frame inside wider phone screens; the camera fits the same frame.
    const root = spawnUIEntity({ world, parent: canvas, node: { position: 1, width: px(1280), height: px(720), insetLeft: percent(50), insetTop: percent(50), marginLeft: px(-640), marginTop: px(-360) } });
    const nodes: Record<string, Entity> = {};
    const box = (x: number, y: number, w: number, h: number) => ({ position: 1, insetLeft: px(x), insetTop: px(y), width: px(w), height: px(h) });
    function named(e: Entity, name: string) { world.insert(e, Name, { value: name }); nodes[name] = e; return e; }
    function group(name: string) { return named(spawnUIEntity({ world, parent: root, node: { fill: true } }), name); }
    function panel(parent: Entity, x: number, y: number, w: number, h: number, color: RGBA, name?: string) {
        const e = spawnUIEntity({ world, parent, node: { ...box(x, y, w, h), pointerEvents: 1 }, visual: { color } });
        return name ? named(e, name) : e;
    }
    function label(parent: Entity, name: string, text: string, x: number, y: number, w: number, h: number, size = 20, color = paper, align = 0, tracking = 0) {
        return named(spawnUIEntity({ world, parent, node: { ...box(x, y, w, h), pointerEvents: 1 },
            text: { content: text, fontSize: size, color, align: align as 0 | 1 | 2, verticalAlign: 1, letterSpacing: tracking, fontFamily: 'sans-serif' } }), name);
    }
    function button(parent: Entity, name: string, text: string, x: number, y: number, w: number, h: number, onClick: () => void, primary = false) {
        const bg = primary ? { r: .7, g: .86, b: .75, a: 1 } : ink;
        panel(parent, x - 1, y - 1, w + 2, h + 2, { ...gold, a: primary ? .9 : .35 });
        const entity = named(createButton({ world, events, parent, node: box(x, y, w, h),
            background: { color: bg }, states: { normal: { color: bg }, hover: { color: primary ? paper : { r: .08, g: .2, b: .24, a: .96 } }, pressed: { color: teal } }, onClick }).entity, name);
        label(entity, name + 'Label', text, 0, 0, w, h, primary ? 26 : 19, primary ? { ...ink, a: 1 } : paper, 1, primary ? 4 : 1);
        return entity;
    }
    const lobby = group('Lobby');
    label(lobby, 'Brand', 'E S T E L L A   /   星 门 计 划', 58, 30, 500, 32, 17, gold);
    panel(lobby, 58, 82, 1164, 1, { ...gold, a: .35 });
    label(lobby, 'Chapter', '序 章     /     遗 落 的 天 穹', 64, 146, 400, 30, 18, gold);
    label(lobby, 'Title', '星 渊', 58, 192, 490, 126, 100, paper);
    label(lobby, 'EnglishTitle', 'S T A R F A L L', 66, 318, 440, 40, 28, teal);
    panel(lobby, 67, 386, 44, 2, gold);
    label(lobby, 'Tagline', '于群星陨落之处，唤醒你的锋芒。', 66, 413, 470, 34, 21, paper);
    label(lobby, 'Lore', '星门已经开启。\n最后的守望者，正在等你。', 66, 466, 420, 64, 18, muted);
    panel(lobby, 916, 180, 300, 250, ink);
    panel(lobby, 916, 180, 3, 250, { ...gold, a: .7 });
    label(lobby, 'MissionTag', 'C E L E S T I A L   T R I A L', 944, 202, 245, 28, 15, gold);
    label(lobby, 'Mission', '星门试炼', 944, 244, 244, 52, 34);
    label(lobby, 'MissionDetail', '60 秒 · 击破 18 个星骸\n闪避弹幕，连斩积累连击', 944, 308, 245, 70, 18, muted);
    label(lobby, 'MissionReward', '奖励     星辉 × 连击倍率', 944, 385, 250, 30, 17, gold);
    button(lobby, 'Enter', '穿 越 星 门', 916, 464, 300, 76, actions.enter, true);
    label(lobby, 'EnterHint', '点击开始  /  ENTER', 916, 555, 300, 30, 16, muted, 1);
    label(lobby, 'HeroName', '流 光   /   星 刃 守 望 者', 494, 594, 390, 34, 19, gold, 1);
    panel(lobby, 58, 647, 1164, 1, { ...gold, a: .35 });
    label(lobby, 'Footer', '极光之境     ·     第一章', 62, 667, 430, 28, 16, muted);
    label(lobby, 'LobbyHint', '横屏游玩     /     触屏与键盘均可操作', 758, 667, 460, 28, 16, muted, 2);

    const common = group('Common');
    button(common, 'Sound', '声音：开启', 948, 29, 128, 36, actions.sound);
    button(common, 'Quality', '性能优先', 1094, 29, 128, 36, actions.quality);
    label(common, 'Perf', '', 970, 136, 250, 24, 14, muted, 2);

    const game = group('HUD');
    panel(game, 44, 26, 324, 88, ink);
    label(game, 'PlayerName', '流光   /   星刃守望者', 64, 38, 284, 30, 19, paper);
    panel(game, 65, 83, 266, 8, { r: .14, g: .25, b: .29, a: 1 });
    panel(game, 65, 83, 266, 8, teal, 'HealthFill');
    label(game, 'Timer', '60', 556, 23, 168, 52, 40, paper, 1);
    label(game, 'Objective', '净化星骸  0 / 18', 490, 78, 300, 30, 18, gold, 1);
    label(game, 'Score', '星辉  0', 408, 30, 150, 32, 18, teal, 0);
    label(game, 'Combo', '', 1040, 182, 184, 62, 32, gold, 2);
    button(game, 'Pause', '暂停', 1154, 88, 68, 38, actions.pause);
    const joystick = createVirtualJoystick({ world, parent: game, inputId: 'move', radius: 58, deadZone: .16,
        node: box(70, 546, 150, 150), baseVisual: { color: { ...ink, a: 0 } }, handleVisual: { color: { ...teal, a: 0 } } });
    named(joystick.entity, 'Move');
    label(game, 'MoveHint', '移 动', 76, 681, 136, 24, 16, paper, 1);
    function control(name: string, text: string, x: number, y: number, w: number, h: number, id: string, color: RGBA) {
        const b = createVirtualButton({ world, events, parent: game, inputId: id, node: box(x, y, w, h),
            background: { color: { ...ink, a: 0 } }, states: { normal: { color: { ...ink, a: 0 } }, pressed: { color: { ...ink, a: 0 } } } });
        named(b.entity, name);
        label(b.entity, name + 'Label', text, 0, 0, w, h, 24, color, 1);
    }
    control('Attack', '斩', 1090, 562, 124, 108, 'attack', teal);
    control('Nova', '星 爆', 950, 516, 106, 86, 'nova', gold);
    control('Dash', '闪', 956, 626, 92, 62, 'dash', paper);
    control('Jump', '跃', 838, 626, 92, 62, 'jump', paper);
    label(game, 'NovaTime', '就绪', 958, 599, 90, 25, 16, gold, 1);
    label(game, 'Guide', '拖动摇杆移动 · 长按「斩」连击\n闪避弹幕，星爆可清除附近弹幕', 340, 638, 470, 55, 17, muted, 1);
    label(game, 'Wave', '星门试炼', 465, 166, 350, 44, 28, paper, 1);

    const modal = group('Modal');
    panel(modal, 0, 0, 1280, 720, { ...ink, a: .86 });
    panel(modal, 388, 150, 504, 2, gold);
    label(modal, 'ResultTag', 'C E L E S T I A L   T R I A L', 390, 182, 500, 36, 17, gold, 1);
    label(modal, 'ResultTitle', '星门已净化', 320, 238, 640, 84, 52, paper, 1);
    label(modal, 'ResultDetail', '', 390, 347, 500, 82, 24, teal, 1);
    button(modal, 'Continue', '继续试炼', 430, 462, 420, 64, actions.resume, true);
    button(modal, 'Return', '返回大厅', 430, 552, 420, 52, actions.lobby);
    const transition = named(spawnUIEntity({ world, parent: root, node: { fill: true, pointerEvents: 1, opacity: 0 }, visual: { color: teal } }), 'Transition');

    function show(name: string, visible: boolean) { const e = nodes[name], n = world.get(e, UINode), display = visible ? UIDisplay.Flex : UIDisplay.None; if (n.display !== display) world.insert(e, UINode, { ...n, display }); }
    function text(name: string, content: string) { const e = nodes[name], t = world.get(e, Text); if (t.content !== content) world.insert(e, Text, { ...t, content }); }
    function buttonText(name: string, content: string) {
        text(name + 'Label', content);
    }
    function opacity(name: string, value: number) { const e = nodes[name], n = world.get(e, UINode); if (Math.abs(n.opacity - value) > .001) world.insert(e, UINode, { ...n, opacity: value }); }
    function health(value: number) { const e = nodes.HealthFill, n = world.get(e, UINode), width = Math.max(0, 266 * value / 100); if (n.width.value !== width) world.insert(e, UINode, { ...n, width: px(width) }); }
    show('HUD', false); show('Modal', false);
    return { nodes, lobby, game, modal, common, transition, show, text, buttonText, opacity, health };
}
