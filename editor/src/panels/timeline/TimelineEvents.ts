type TimelineOpenListener = (path: string) => void;

const listeners_: TimelineOpenListener[] = [];

export function onTimelineOpen(listener: TimelineOpenListener): () => void {
    listeners_.push(listener);
    return () => {
        const idx = listeners_.indexOf(listener);
        if (idx >= 0) listeners_.splice(idx, 1);
    };
}

export function emitTimelineOpen(path: string): void {
    for (const fn of listeners_) fn(path);
}
