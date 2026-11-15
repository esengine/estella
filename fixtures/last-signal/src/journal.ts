export type EventType = 'session' | 'build' | 'remove' | 'power_outage' | 'mine_toggle' | 'delivery' | 'repair' | 'victory';

export interface Entry {
    type: EventType;
    seconds: number;
    gameHours: number;
    [key: string]: string | number | boolean;
}

export interface Pulse {
    canAct: boolean;
    input: boolean;
}

export interface Gap {
    seconds: number;
    couldActSeconds: number;
    inputSeconds: number;
    looks: number;
}

export interface Summary {
    seconds: number;
    gameHours: number;
    builds: number;
    refusedBuilds: number;
    removes: number;
    toggles: number;
    deliveries: number;
    oreDelivered: number;
    outages: number;
    outageHours: number;
    failedRepairs: number;
    actions: number;
    longestGapSeconds: number;
    idleSeconds: number;
    couldActIdleSeconds: number;
    nothingToDoSeconds: number;
    won: boolean;
}

const round = (value: number, digits = 1): number => Number(value.toFixed(digits));

export class Journal {
    readonly entries: Entry[] = [];
    private seconds = 0;
    private gameHours = 0;
    private gap: Gap = { seconds: 0, couldActSeconds: 0, inputSeconds: 0, looks: 0 };
    private outageStart: { seconds: number; gameHours: number } | null = null;

    constructor(readonly session: string) {
        this.entries.push({ type: 'session', seconds: 0, gameHours: 0, session });
    }

    tick(seconds: number, gameHours: number, pulse: Pulse): void {
        this.seconds += seconds;
        this.gameHours += gameHours;
        this.gap.seconds += seconds;
        if (pulse.canAct) this.gap.couldActSeconds += seconds;
        if (pulse.input) this.gap.inputSeconds += seconds;
    }

    look(): void {
        this.gap.looks += 1;
    }

    note(type: EventType, data: Record<string, string | number | boolean> = {}): Entry {
        const entry: Entry = { type, seconds: round(this.seconds), gameHours: round(this.gameHours, 2), ...data };
        this.entries.push(entry);
        return entry;
    }

    act(type: EventType, data: Record<string, string | number | boolean> = {}): Entry {
        const gap = this.gap;
        this.gap = { seconds: 0, couldActSeconds: 0, inputSeconds: 0, looks: 0 };
        return this.note(type, {
            ...data,
            gapSeconds: round(gap.seconds), gapCouldActSeconds: round(gap.couldActSeconds),
            gapInputSeconds: round(gap.inputSeconds), gapLooks: gap.looks,
        });
    }

    outage(dark: boolean): void {
        if (dark && this.outageStart === null) {
            this.outageStart = { seconds: this.seconds, gameHours: this.gameHours };
        } else if (!dark && this.outageStart !== null) {
            const from = this.outageStart;
            this.outageStart = null;
            this.entries.push({
                type: 'power_outage', seconds: round(from.seconds), gameHours: round(from.gameHours, 2),
                lastedSeconds: round(this.seconds - from.seconds), lastedHours: round(this.gameHours - from.gameHours, 2),
            });
        }
    }

    summary(): Summary {
        const of = (type: EventType): Entry[] => this.entries.filter((e) => e.type === type);
        const acted = this.entries.filter((e) => typeof e.gapSeconds === 'number');
        const gaps = [...acted.map((e) => ({ seconds: e.gapSeconds as number, could: e.gapCouldActSeconds as number })),
            { seconds: this.gap.seconds, could: this.gap.couldActSeconds }];
        const openOutage = this.outageStart === null ? 0 : this.gameHours - this.outageStart.gameHours;
        const idle = gaps.reduce((sum, g) => sum + g.seconds, 0);
        const could = gaps.reduce((sum, g) => sum + g.could, 0);
        return {
            seconds: round(this.seconds),
            gameHours: round(this.gameHours, 2),
            builds: of('build').filter((e) => e.ok !== false).length,
            refusedBuilds: of('build').filter((e) => e.ok === false).length,
            removes: of('remove').length,
            toggles: of('mine_toggle').length,
            deliveries: of('delivery').length,
            oreDelivered: of('delivery').reduce((sum, e) => sum + (e.ore as number), 0),
            outages: of('power_outage').length + (this.outageStart === null ? 0 : 1),
            outageHours: round(of('power_outage').reduce((sum, e) => sum + (e.lastedHours as number), 0) + openOutage, 2),
            failedRepairs: of('repair').filter((e) => e.ok === false).length,
            actions: acted.length,
            longestGapSeconds: round(Math.max(...gaps.map((g) => g.seconds))),
            idleSeconds: round(idle),
            couldActIdleSeconds: round(could),
            nothingToDoSeconds: round(idle - could),
            won: of('victory').length > 0,
        };
    }

    export(): { session: string; summary: Summary; entries: Entry[] } {
        return { session: this.session, summary: this.summary(), entries: this.entries };
    }
}
