import { icons } from '../../utils/icons';
import type { TimelineState } from './TimelineState';
import type { EditorStore } from '../../store/EditorStore';
import type { TimelineTrackData } from './TimelineKeyframeArea';
import type { SelectedKeyframeInfo } from './TimelineKeyframeArea';
import { TimelineAddTrackWizard } from './TimelineAddTrackWizard';

export type AddTrackCallback = (track: TimelineTrackData) => void;
export type KeyframeValueChangeCallback = (trackIndex: number, channelIndex: number, keyframeIndex: number, value: number) => void;

export class TimelineToolbar {
    private el_: HTMLElement;
    private state_: TimelineState;
    private store_: EditorStore;
    private timeDisplay_: HTMLElement | null = null;
    private playBtn_: HTMLElement | null = null;
    private recordBtn_: HTMLElement | null = null;
    private valueGroup_: HTMLElement | null = null;
    private valueInput_: HTMLInputElement | null = null;
    private unsub_: (() => void) | null = null;
    private onAddTrack_: AddTrackCallback | null = null;
    private onValueChange_: KeyframeValueChangeCallback | null = null;
    private wizard_: TimelineAddTrackWizard | null = null;
    private boundEntityId_: number | null = null;
    private selectedKf_: SelectedKeyframeInfo | null = null;

    constructor(
        container: HTMLElement,
        state: TimelineState,
        store: EditorStore,
        onAddTrack?: AddTrackCallback,
        onValueChange?: KeyframeValueChangeCallback,
    ) {
        this.el_ = container;
        this.state_ = state;
        this.store_ = store;
        this.onAddTrack_ = onAddTrack ?? null;
        this.onValueChange_ = onValueChange ?? null;
        this.render();
        this.unsub_ = state.onChange(() => this.update());
    }

    dispose(): void {
        this.unsub_?.();
        this.wizard_?.hide();
    }

    setBoundEntity(entityId: number | null): void {
        this.boundEntityId_ = entityId;
    }

    setSelectedKeyframe(info: SelectedKeyframeInfo | null): void {
        this.selectedKf_ = info;
        this.updateValueField();
    }

    private render(): void {
        this.el_.innerHTML = `
            <div class="es-timeline-toolbar">
                <div class="es-timeline-transport">
                    <button class="es-btn es-btn-icon es-timeline-record-btn" data-action="record" title="Record">${icons.circle(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="stop" title="Stop">${icons.stop(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="play" title="Play">${icons.play(12)}</button>
                </div>
                <div class="es-timeline-time-display">0:00.00 / 0:00.00</div>
                <div class="es-timeline-value-group" style="display:none">
                    <span class="es-timeline-value-label">Value</span>
                    <input type="number" class="es-input es-timeline-value-input" step="any" />
                </div>
                <div class="es-timeline-toolbar-right">
                    <button class="es-btn es-btn-icon" data-action="add-track" title="Add Track">${icons.plus(12)}</button>
                </div>
            </div>
        `;

        this.timeDisplay_ = this.el_.querySelector('.es-timeline-time-display');
        this.playBtn_ = this.el_.querySelector('[data-action="play"]');
        this.recordBtn_ = this.el_.querySelector('[data-action="record"]');
        this.valueGroup_ = this.el_.querySelector('.es-timeline-value-group');
        this.valueInput_ = this.el_.querySelector('.es-timeline-value-input');

        this.el_.querySelector('[data-action="record"]')?.addEventListener('click', () => {
            this.state_.recording = !this.state_.recording;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="play"]')?.addEventListener('click', () => {
            this.state_.playing = !this.state_.playing;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="stop"]')?.addEventListener('click', () => {
            this.state_.playing = false;
            this.state_.playheadTime = 0;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="add-track"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showWizard(e.target as HTMLElement);
        });

        this.valueInput_?.addEventListener('change', () => {
            if (!this.selectedKf_ || !this.valueInput_) return;
            const newValue = parseFloat(this.valueInput_.value);
            if (isNaN(newValue)) return;
            this.onValueChange_?.(
                this.selectedKf_.trackIndex,
                this.selectedKf_.channelIndex,
                this.selectedKf_.keyframeIndex,
                newValue,
            );
        });

        this.valueInput_?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.valueInput_?.blur();
            }
            e.stopPropagation();
        });
    }

    private updateValueField(): void {
        if (!this.valueGroup_ || !this.valueInput_) return;
        if (this.selectedKf_) {
            this.valueGroup_.style.display = 'flex';
            this.valueInput_.value = String(parseFloat(this.selectedKf_.value.toFixed(4)));
        } else {
            this.valueGroup_.style.display = 'none';
        }
    }

    private showWizard(anchor: HTMLElement): void {
        this.wizard_?.hide();
        this.wizard_ = new TimelineAddTrackWizard(
            this.store_,
            this.boundEntityId_,
            (track) => this.onAddTrack_?.(track),
        );
        this.wizard_.show(anchor);
    }

    private update(): void {
        if (this.timeDisplay_) {
            const current = this.state_.formatTime(this.state_.playheadTime);
            const total = this.state_.formatTime(this.state_.duration);
            this.timeDisplay_.textContent = `${current} / ${total}`;
        }
        if (this.playBtn_) {
            this.playBtn_.innerHTML = this.state_.playing ? icons.pause(12) : icons.play(12);
            this.playBtn_.title = this.state_.playing ? 'Pause' : 'Play';
        }
        if (this.recordBtn_) {
            this.recordBtn_.classList.toggle('es-active', this.state_.recording);
        }
    }
}
