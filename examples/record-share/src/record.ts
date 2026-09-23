import {
    defineSystem, Res, GetWorld, Time, Name, UIEvents, UINode, UIDisplay, Text, createButton, themeColors, px,
} from 'esengine';
import type { Entity, World, UIEventQueue, TextData, TimeData } from 'esengine';
import { Recorder, type RecorderAPI } from 'estella-plugin-minigame-services';

/** How often the demo pretends something worth keeping just happened. */
const HIGHLIGHT_EVERY_S = 4;

const ui = {
    built: false,
    record: null as Entity | null,
    stop: null as Entity | null,
    share: null as Entity | null,
    status: null as Entity | null,
    sinceHighlight: 0,
    highlights: 0,
    message: '',
};

export const recordUiSystem = defineSystem(
    [Res(UIEvents), Res(Recorder), GetWorld()],
    (events: UIEventQueue, recorder: RecorderAPI, world: World) => {
        if (ui.built) return;
        const row = world.findEntityByName('ButtonRow');
        ui.status = world.findEntityByName('Status');
        if (row === null || ui.status === null) return;
        ui.built = true;

        const c = themeColors();
        const button = (label: string, onClick: () => void): Entity => {
            const { entity } = createButton({
                world, events, parent: row,
                node: { width: px(150), height: px(44) },
                states: { normal: { color: c.primary }, hover: { color: c.primary }, pressed: { color: c.primary } },
                text: { content: label, color: c.onPrimary, fontSize: 16 },
                onClick,
            });
            world.insert(entity, Name, { value: `${label}Button` });
            return entity;
        };

        ui.record = button('Record', () => {
            ui.highlights = 0;
            ui.sinceHighlight = 0;
            recorder.start({ maxSeconds: 60 }).catch((e: Error) => { ui.message = e.message; });
        });
        ui.stop = button('Stop', () => {
            recorder.stop()
                .then((r) => { ui.message = `recorded ${(r.durationMs / 1000).toFixed(1)}s, ${r.highlights.length} highlight(s)`; })
                .catch((e: Error) => { ui.message = e.message; });
        });
        // A share has to come from the player's tap — both hosts refuse any other.
        ui.share = button('Share', () => {
            recorder.share({ title: 'Look at this run' })
                .then(() => { ui.message = 'shared'; })
                .catch((e: Error) => { ui.message = e.message; });
        });
        recorder.onFailure((e) => { ui.message = `recording stopped: ${e.message}`; });
    },
    { name: 'RecordUiSystem' },
);

export const recordStateSystem = defineSystem(
    [Res(Recorder), Res(Time), GetWorld()],
    (recorder: RecorderAPI, time: TimeData, world: World) => {
        if (!ui.built) return;
        const recording = recorder.state === 'recording' || recorder.state === 'paused';

        if (recorder.state === 'recording') {
            ui.sinceHighlight += time.delta;
            if (ui.sinceHighlight >= HIGHLIGHT_EVERY_S) {
                ui.sinceHighlight = 0;
                ui.highlights++;
                recorder.highlight(2, 1);
            }
        }

        show(world, ui.record, recorder.available && !recording);
        show(world, ui.stop, recording);
        // Hidden, not disabled, where it cannot work: a button that only ever
        // fails teaches the player to ignore it.
        show(world, ui.share, recorder.canShare && recorder.last !== null && !recording);

        const line = !recorder.available ? 'This platform cannot record.'
            : recording ? `Recording… ${ui.highlights} highlight(s) marked`
            : ui.message || (recorder.canShare ? 'Record a run, then share it.' : 'Record a run — sharing needs a mini-game host.');
        setText(world, ui.status, line);
    },
    { name: 'RecordStateSystem' },
);

function show(world: World, entity: Entity | null, on: boolean): void {
    if (entity === null || !world.valid(entity)) return;
    const node = world.get(entity, UINode);
    const display = on ? UIDisplay.Flex : UIDisplay.None;
    if (node.display === display) return;
    node.display = display;
    world.insert(entity, UINode, node);
}

function setText(world: World, entity: Entity | null, content: string): void {
    if (entity === null || !world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    if (t.content === content) return;
    t.content = content;
    world.insert(entity, Text, t);
}
