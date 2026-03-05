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

export class TimelineTrackList {
    private el_: HTMLElement;
    private state_: TimelineState;
    private listEl_: HTMLElement | null = null;
    private unsub_: (() => void) | null = null;
    private assetData_: TimelineAssetData | null = null;

    constructor(container: HTMLElement, state: TimelineState) {
        this.el_ = container;
        this.state_ = state;
        this.render();
        this.unsub_ = state.onChange(() => this.update());
    }

    dispose(): void {
        this.unsub_?.();
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
    }

    private renderTrackRow(track: TimelineTrackState): void {
        if (!this.listEl_) return;

        const row = document.createElement('div');
        row.className = 'es-timeline-track-row';
        if (track.index === this.state_.selectedTrackIndex) {
            row.classList.add('es-selected');
        }
        row.style.height = `${TRACK_HEIGHT}px`;

        const iconFn = TRACK_TYPE_ICONS[track.type] ?? icons.circle;
        const expandIcon = track.channelCount > 0
            ? `<span class="es-timeline-expand ${track.expanded ? 'es-expanded' : ''}">${icons.chevronRight(10)}</span>`
            : '<span class="es-timeline-expand-spacer"></span>';

        row.innerHTML = `
            ${expandIcon}
            <span class="es-timeline-track-icon">${iconFn(12)}</span>
            <span class="es-timeline-track-name">${track.name}</span>
        `;

        row.addEventListener('click', () => {
            this.state_.selectedTrackIndex = track.index;
            this.state_.notify();
        });

        const expandEl = row.querySelector('.es-timeline-expand');
        expandEl?.addEventListener('click', (e) => {
            e.stopPropagation();
            track.expanded = !track.expanded;
            this.state_.notify();
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
            channelRow.innerHTML = `<span class="es-timeline-channel-name">${channelName}</span>`;
            this.listEl_.appendChild(channelRow);
        }
    }

    updateChannelNames(trackIndex: number, names: string[]): void {
        const track = this.state_.tracks[trackIndex];
        if (!track) return;
        track.channelCount = names.length;
        this.update();
    }
}
