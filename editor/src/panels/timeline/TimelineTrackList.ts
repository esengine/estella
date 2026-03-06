import { icons } from '../../utils/icons';
import type { TimelineState, TimelineTrackState } from './TimelineState';
import { TRACK_HEIGHT } from './TimelineState';
import type { TimelineAssetData } from './TimelineKeyframeArea';

const TRACK_TYPE_ICONS: Record<string, (size: number) => string> = {
    property: icons.settings,
    spine: icons.box,
    spriteAnim: icons.film,
    audio: icons.volume,
    activation: icons.eye,
};

const TRACK_TYPE_COLORS: Record<string, string> = {
    property: '#e5c07b',
    spine: '#61afef',
    spriteAnim: '#c678dd',
    audio: '#d19a66',
    activation: '#98c379',
};

const DRAG_START_DELAY_MS = 200;

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type TrackReorderCallback = (fromIndex: number, toIndex: number) => void;
export type TrackRenameCallback = (trackIndex: number, oldName: string, newName: string) => void;
export type ChannelClickCallback = (trackIndex: number, channelIndex: number) => void;

export class TimelineTrackList {
    private el_: HTMLElement;
    private state_: TimelineState;
    private listEl_: HTMLElement | null = null;
    private unsub_: (() => void) | null = null;
    private assetData_: TimelineAssetData | null = null;
    private onReorder_: TrackReorderCallback | null = null;
    private onRename_: TrackRenameCallback | null = null;
    private onChannelClick_: ChannelClickCallback | null = null;
    private dragState_: { trackIndex: number; startY: number; timer: number | null } | null = null;
    private dragIndicator_: HTMLElement | null = null;
    private updatingScroll_ = false;

    constructor(
        container: HTMLElement,
        state: TimelineState,
        onReorder?: TrackReorderCallback,
        onRename?: TrackRenameCallback,
        onChannelClick?: ChannelClickCallback,
    ) {
        this.el_ = container;
        this.state_ = state;
        this.onReorder_ = onReorder ?? null;
        this.onRename_ = onRename ?? null;
        this.onChannelClick_ = onChannelClick ?? null;
        this.render();
        this.unsub_ = state.onChange(() => this.update());

        this.el_.addEventListener('scroll', () => {
            if (this.updatingScroll_) return;
            this.state_.scrollY = this.el_.scrollTop;
            this.state_.notify();
        });
    }

    dispose(): void {
        this.unsub_?.();
        this.cancelDrag();
    }

    setAssetData(data: TimelineAssetData | null): void {
        this.assetData_ = data;
        this.update();
    }

    private render(): void {
        this.el_.innerHTML = `<div class="es-timeline-track-list"></div>`;
        this.listEl_ = this.el_.querySelector('.es-timeline-track-list');
        this.update();
    }

    private update(): void {
        if (!this.listEl_) return;
        this.listEl_.innerHTML = '';

        if (this.state_.tracks.length === 0) {
            this.listEl_.innerHTML = '<div class="es-timeline-empty">No tracks</div>';
            return;
        }

        for (const track of this.state_.tracks) {
            this.renderTrackRow(track);
        }

        this.updatingScroll_ = true;
        this.el_.scrollTop = this.state_.scrollY;
        this.updatingScroll_ = false;
    }

    private renderTrackRow(track: TimelineTrackState): void {
        if (!this.listEl_) return;

        const row = document.createElement('div');
        row.className = 'es-timeline-track-row';
        if (track.index === this.state_.selectedTrackIndex) {
            row.classList.add('es-selected');
        }
        row.style.height = `${TRACK_HEIGHT}px`;

        const typeColor = TRACK_TYPE_COLORS[track.type] ?? '#888';
        const iconFn = TRACK_TYPE_ICONS[track.type] ?? icons.circle;
        const expandIcon = track.channelCount > 0
            ? `<span class="es-timeline-expand ${track.expanded ? 'es-expanded' : ''}">${icons.chevronRight(10)}</span>`
            : '<span class="es-timeline-expand-spacer"></span>';

        row.innerHTML = `
            <span class="es-timeline-track-color-bar" style="background:${typeColor}"></span>
            ${expandIcon}
            <span class="es-timeline-track-icon">${iconFn(12)}</span>
            <span class="es-timeline-track-name">${escapeHtml(track.name)}</span>
        `;

        row.addEventListener('click', () => {
            this.state_.selectedTrackIndex = track.index;
            this.state_.notify();
        });

        const nameEl = row.querySelector('.es-timeline-track-name') as HTMLElement;
        nameEl?.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.startInlineRename(nameEl, track);
        });

        const expandEl = row.querySelector('.es-timeline-expand');
        expandEl?.addEventListener('click', (e) => {
            e.stopPropagation();
            track.expanded = !track.expanded;
            this.state_.notify();
        });

        row.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.beginDragDelay(e, track.index);
        });

        this.listEl_.appendChild(row);

        if (track.expanded && track.channelCount > 0) {
            this.renderChannelRows(track);
        }
    }

    private renderChannelRows(track: TimelineTrackState): void {
        if (!this.listEl_) return;

        const trackData = this.assetData_?.tracks[track.index];
        const channels = trackData?.channels;

        for (let i = 0; i < track.channelCount; i++) {
            const channelRow = document.createElement('div');
            channelRow.className = 'es-timeline-channel-row';
            channelRow.style.height = `${TRACK_HEIGHT}px`;
            const channelName = channels?.[i]?.property ?? `channel ${i}`;
            channelRow.innerHTML = `<span class="es-timeline-channel-name">${escapeHtml(channelName)}</span>`;

            channelRow.addEventListener('click', (e) => {
                e.stopPropagation();
                this.onChannelClick_?.(track.index, i);
            });

            this.listEl_.appendChild(channelRow);
        }
    }

    private startInlineRename(nameEl: HTMLElement, track: TimelineTrackState): void {
        const oldName = track.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-input es-timeline-rename-input';
        input.value = oldName;
        input.style.width = '100%';
        input.style.height = '20px';
        input.style.fontSize = '11px';

        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim();
            input.remove();
            nameEl.textContent = newName || oldName;
            if (newName && newName !== oldName) {
                this.onRename_?.(track.index, oldName, newName);
            }
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = oldName;
                input.blur();
            }
            e.stopPropagation();
        });
    }

    private beginDragDelay(e: MouseEvent, trackIndex: number): void {
        this.cancelDrag();
        const startY = e.clientY;
        const timer = window.setTimeout(() => {
            this.startDrag(trackIndex, startY);
        }, DRAG_START_DELAY_MS);

        this.dragState_ = { trackIndex, startY, timer };

        const onUp = () => {
            this.cancelDrag();
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('mousemove', onEarlyMove);
        };

        const onEarlyMove = (ev: MouseEvent) => {
            if (Math.abs(ev.clientY - startY) > 5 && this.dragState_?.timer) {
                clearTimeout(this.dragState_.timer);
                this.dragState_.timer = null;
                this.startDrag(trackIndex, startY);
                document.removeEventListener('mousemove', onEarlyMove);
            }
        };

        document.addEventListener('mouseup', onUp, { once: true });
        document.addEventListener('mousemove', onEarlyMove);
    }

    private startDrag(fromIndex: number, _startY: number): void {
        if (!this.listEl_) return;

        const indicator = document.createElement('div');
        indicator.className = 'es-timeline-drag-indicator';
        this.listEl_.appendChild(indicator);
        this.dragIndicator_ = indicator;

        const onMove = (ev: MouseEvent) => {
            const rect = this.listEl_!.getBoundingClientRect();
            const y = ev.clientY - rect.top + this.el_.scrollTop;
            const toIndex = Math.max(0, Math.min(
                this.state_.tracks.length,
                Math.round(y / TRACK_HEIGHT),
            ));
            indicator.style.top = `${toIndex * TRACK_HEIGHT - 1}px`;
            indicator.dataset.toIndex = String(toIndex);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            const toIndex = parseInt(indicator.dataset.toIndex ?? '-1');
            indicator.remove();
            this.dragIndicator_ = null;

            if (toIndex >= 0 && toIndex !== fromIndex && toIndex !== fromIndex + 1) {
                const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
                this.onReorder_?.(fromIndex, adjustedTo);
            }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    private cancelDrag(): void {
        if (this.dragState_?.timer) {
            clearTimeout(this.dragState_.timer);
        }
        this.dragIndicator_?.remove();
        this.dragIndicator_ = null;
        this.dragState_ = null;
    }

    updateChannelNames(trackIndex: number, names: string[]): void {
        const track = this.state_.tracks[trackIndex];
        if (!track) return;
        track.channelCount = names.length;
        this.update();
    }
}
