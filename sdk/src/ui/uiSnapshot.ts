type SnapshotValue = number | string | boolean;

export type Snapshot = Record<string, SnapshotValue>;

export function createSnapshotUtils<TSource>(
    spec: Record<string, (source: TSource) => SnapshotValue>
) {
    const keys = Object.keys(spec);
    const extractors = keys.map(k => spec[k]);

    return {
        take(source: TSource): Snapshot {
            const snap: Snapshot = {};
            for (let i = 0; i < keys.length; i++) {
                snap[keys[i]] = extractors[i](source);
            }
            return snap;
        },
        changed(snapshot: Snapshot, source: TSource): boolean {
            for (let i = 0; i < keys.length; i++) {
                if (snapshot[keys[i]] !== extractors[i](source)) return true;
            }
            return false;
        },
        update(snapshot: Snapshot, source: TSource): void {
            for (let i = 0; i < keys.length; i++) {
                snapshot[keys[i]] = extractors[i](source);
            }
        },
    };
}
