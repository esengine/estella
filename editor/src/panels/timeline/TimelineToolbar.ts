import { icons } from '../../utils/icons';
import type { TimelineState, WrapMode } from './TimelineState';
import type { EditorStore } from '../../store/EditorStore';
import type { TimelineTrackData } from './TimelineKeyframeArea';
import type { SelectedKeyframeInfo, SelectionSummary } from './TimelineKeyframeArea';
import { TimelineAddTrackWizard } from './TimelineAddTrackWizard';

export type AddTrackCallback = (track: TimelineTrackData) => void;
export type KeyframeValueChangeCallback = (trackIndex: number, channelIndex: number, keyframeIndex: number, value: number) => void;
export type DurationChangeCallback = (newDuration: number) => void;

const FRAME_STEP = 1 / 60;
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
const WRAP_MODES: WrapMode[] = ['once', 'loop', 'pingPong'];
const WRAP_LABELS: Record<WrapMode, string> = { once: 'Once', loop: 'Loop', pingPong: 'Ping Pong' };

export class TimelineToolbar {
    private el_: HTMLElement;
    private state_: TimelineState;
    private store_: EditorStore;
    private timeDisplay_: HTMLElement | null = null;
    private playBtn_: HTMLElement | null = null;
    private recordBtn_: HTMLElement | null = null;
    private wrapBtn_: HTMLElement | null = null;
    private speedBtn_: HTMLElement | null = null;
    private snapBtn_: HTMLElement | null = null;
    private valueGroup_: HTMLElement | null = null;
    private valueInput_: HTMLInputElement | null = null;
    private animClipGroup_: HTMLElement | null = null;
    private fpsInput_: HTMLInputElement | null = null;
    private loopBtn_: HTMLElement | null = null;
    private unsub_: (() => void) | null = null;
    private onAddTrack_: AddTrackCallback | null = null;
    private onValueChange_: KeyframeValueChangeCallback | null = null;
    private onDurationChange_: DurationChangeCallback | null = null;
    private wizard_: TimelineAddTrackWizard | null = null;
    private boundEntityId_: number | null = null;
    private selectedKf_: SelectedKeyframeInfo | null = null;
    private selectionCount_ = 0;

    constructor(
        container: HTMLElement,
        state: TimelineState,
        store: EditorStore,
        onAddTrack?: AddTrackCallback,
        onValueChange?: KeyframeValueChangeCallback,
        onDurationChange?: DurationChangeCallback,
    ) {
        this.el_ = container;
        this.state_ = state;
        this.store_ = store;
        this.onAddTrack_ = onAddTrack ?? null;
        this.onValueChange_ = onValueChange ?? null;
        this.onDurationChange_ = onDurationChange ?? null;
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
        this.selectionCount_ = info ? 1 : 0;
        this.updateValueField();
    }

    setSelectionSummary(summary: SelectionSummary): void {
        this.selectedKf_ = summary.single;
        this.selectionCount_ = summary.count;
        this.updateValueField();
    }

    private stepFrame(direction: number): void {
        const newTime = this.state_.playheadTime + direction * FRAME_STEP;
        this.state_.setPlayhead(newTime);
    }

    private render(): void {
        this.el_.innerHTML = `
            <div class="es-timeline-toolbar">
                <div class="es-timeline-transport">
                    <button class="es-btn es-btn-icon es-timeline-record-btn" data-action="record" title="Record">${icons.circle(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="skip-back" title="Go to Start">${icons.skipBack(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="step-back" title="Previous Frame (,)">${icons.stepBack(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="play" title="Play">${icons.play(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="step-forward" title="Next Frame (.)">${icons.stepForward(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="skip-forward" title="Go to End">${icons.skipForward(12)}</button>
                </div>
                <span class="es-timeline-live-indicator" style="display:none;align-items:center;gap:4px;color:#ff4444;font-size:11px;font-weight:600;margin-left:8px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff4444;animation:es-blink 1s infinite"></span>LIVE</span>
                <div class="es-timeline-time-display" title="Double-click to edit duration">0:00.00 / 0:00.00</div>
                <div class="es-timeline-value-group" style="display:none">
                    <span class="es-timeline-value-label">Value</span>
                    <input type="number" class="es-input es-timeline-value-input" step="any" />
                </div>
                <div class="es-timeline-animclip-group" style="display:none">
                    <span class="es-timeline-value-label">FPS</span>
                    <input type="number" class="es-input es-timeline-fps-input" min="1" max="120" step="1" style="width:48px" />
                    <button class="es-btn es-btn-sm es-timeline-loop-btn" data-action="loop" title="Loop">Loop</button>
                </div>
                <div class="es-timeline-toolbar-right">
                    <button class="es-btn es-btn-sm es-timeline-speed-btn" data-action="speed" title="Playback Speed">1x</button>
                    <button class="es-btn es-btn-icon es-timeline-wrap-btn" data-action="wrap" title="Wrap Mode: Once">${icons.repeat(12)}</button>
                    <button class="es-btn es-btn-icon es-timeline-snap-btn es-active" data-action="snap" title="Snap to Grid">${icons.grid(12)}</button>
                    <button class="es-btn es-btn-icon" data-action="add-track" title="Add Track">${icons.plus(12)}</button>
                </div>
            </div>
        `;

        this.timeDisplay_ = this.el_.querySelector('.es-timeline-time-display');
        this.playBtn_ = this.el_.querySelector('[data-action="play"]');
        this.recordBtn_ = this.el_.querySelector('[data-action="record"]');
        this.wrapBtn_ = this.el_.querySelector('[data-action="wrap"]');
        this.speedBtn_ = this.el_.querySelector('[data-action="speed"]');
        this.snapBtn_ = this.el_.querySelector('[data-action="snap"]');
        this.valueGroup_ = this.el_.querySelector('.es-timeline-value-group');
        this.valueInput_ = this.el_.querySelector('.es-timeline-value-input');
        this.animClipGroup_ = this.el_.querySelector('.es-timeline-animclip-group');
        this.fpsInput_ = this.el_.querySelector('.es-timeline-fps-input');
        this.loopBtn_ = this.el_.querySelector('.es-timeline-loop-btn');

        this.el_.querySelector('[data-action="record"]')?.addEventListener('click', () => {
            this.state_.recording = !this.state_.recording;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="play"]')?.addEventListener('click', () => {
            this.state_.playing = !this.state_.playing;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="skip-back"]')?.addEventListener('click', () => {
            this.state_.playing = false;
            this.state_.playheadTime = 0;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="skip-forward"]')?.addEventListener('click', () => {
            this.state_.playing = false;
            this.state_.playheadTime = this.state_.duration;
            this.state_.notify();
        });

        this.el_.querySelector('[data-action="step-back"]')?.addEventListener('click', () => {
            this.stepFrame(-1);
        });

        this.el_.querySelector('[data-action="step-forward"]')?.addEventListener('click', () => {
            this.stepFrame(1);
        });

        this.el_.querySelector('[data-action="speed"]')?.addEventListener('click', () => {
            this.cycleSpeed();
        });

        this.el_.querySelector('[data-action="wrap"]')?.addEventListener('click', () => {
            this.cycleWrapMode();
        });

        this.el_.querySelector('[data-action="snap"]')?.addEventListener('click', () => {
            this.state_.snapEnabled = !this.state_.snapEnabled;
            this.snapBtn_?.classList.toggle('es-active', this.state_.snapEnabled);
        });

        this.el_.querySelector('[data-action="add-track"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showWizard(e.target as HTMLElement);
        });

        this.timeDisplay_?.addEventListener('dblclick', () => {
            this.editDuration();
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

        this.fpsInput_?.addEventListener('change', () => {
            if (!this.fpsInput_) return;
            const fps = Math.max(1, Math.min(120, parseInt(this.fpsInput_.value, 10)));
            if (isNaN(fps)) return;
            this.state_.animClipFps = fps;
            this.state_.notify();
        });

        this.fpsInput_?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.fpsInput_?.blur();
            e.stopPropagation();
        });

        this.loopBtn_?.addEventListener('click', () => {
            this.state_.animClipLoop = !this.state_.animClipLoop;
            this.updateLoopButton();
            this.state_.notify();
        });
    }

    private cycleSpeed(): void {
        const currentIdx = SPEED_OPTIONS.indexOf(this.state_.playbackSpeed);
        const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
        this.state_.playbackSpeed = SPEED_OPTIONS[nextIdx];
        this.updateSpeedButton();
        this.state_.notify();
    }

    private cycleWrapMode(): void {
        const currentIdx = WRAP_MODES.indexOf(this.state_.wrapMode);
        const nextIdx = (currentIdx + 1) % WRAP_MODES.length;
        this.state_.wrapMode = WRAP_MODES[nextIdx];
        this.updateWrapButton();
        this.state_.notify();
    }

    private editDuration(): void {
        if (!this.timeDisplay_) return;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input es-timeline-duration-input';
        input.value = String(this.state_.duration);
        input.step = '0.1';
        input.min = '0.1';
        input.style.width = '80px';

        const original = this.timeDisplay_.textContent ?? '';
        this.timeDisplay_.textContent = '';
        this.timeDisplay_.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const newDuration = parseFloat(input.value);
            if (!isNaN(newDuration) && newDuration > 0) {
                this.state_.duration = newDuration;
                this.onDurationChange_?.(newDuration);
                this.state_.notify();
            }
            if (this.timeDisplay_) {
                input.remove();
                this.timeDisplay_.textContent = original;
                this.update();
            }
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = String(this.state_.duration);
                input.blur();
            }
            e.stopPropagation();
        });
    }

    private updateValueField(): void {
        if (!this.valueGroup_ || !this.valueInput_) return;
        if (this.selectedKf_ && this.selectionCount_ === 1) {
            this.valueGroup_.style.display = 'flex';
            const label = this.valueGroup_.querySelector('.es-timeline-value-label');
            if (label) label.textContent = 'Value';
            this.valueInput_.style.display = '';
            this.valueInput_.value = String(parseFloat(this.selectedKf_.value.toFixed(4)));
        } else if (this.selectionCount_ > 1) {
            this.valueGroup_.style.display = 'flex';
            const label = this.valueGroup_.querySelector('.es-timeline-value-label');
            if (label) label.textContent = `${this.selectionCount_} keyframes`;
            this.valueInput_.style.display = 'none';
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

    private updateSpeedButton(): void {
        if (this.speedBtn_) {
            this.speedBtn_.textContent = `${this.state_.playbackSpeed}x`;
        }
    }

    private updateLoopButton(): void {
        if (this.loopBtn_) {
            this.loopBtn_.classList.toggle('es-active', this.state_.animClipLoop);
            this.loopBtn_.textContent = this.state_.animClipLoop ? 'Loop' : 'Once';
        }
    }

    setLiveMode(live: boolean): void {
        const indicator = this.el_.querySelector('.es-timeline-live-indicator') as HTMLElement | null;
        if (indicator) {
            indicator.style.display = live ? 'inline-flex' : 'none';
        }
        if (this.playBtn_) {
            (this.playBtn_ as HTMLButtonElement).disabled = live;
            this.playBtn_.style.opacity = live ? '0.4' : '';
        }
    }

    private updateAnimClipControls(): void {
        if (this.animClipGroup_) {
            this.animClipGroup_.style.display = this.state_.animClipMode ? 'flex' : 'none';
        }
        if (this.fpsInput_ && this.state_.animClipMode) {
            this.fpsInput_.value = String(this.state_.animClipFps);
        }
        this.updateLoopButton();
    }

    private updateWrapButton(): void {
        if (this.wrapBtn_) {
            this.wrapBtn_.title = `Wrap Mode: ${WRAP_LABELS[this.state_.wrapMode]}`;
            this.wrapBtn_.classList.toggle('es-active', this.state_.wrapMode !== 'once');
        }
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
        this.updateAnimClipControls();
    }
}
