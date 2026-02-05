/**
 * @file    BuildProgressPanel.ts
 * @brief   Floating build progress panel UI
 */

import {
    BuildProgress,
    BuildProgressReporter,
    BuildPhase,
    BuildLogEntry,
    formatDuration,
} from './BuildProgress';

// =============================================================================
// Types
// =============================================================================

export type CancelCallback = () => void;

// =============================================================================
// Phase Display Names
// =============================================================================

const PHASE_DISPLAY_NAMES: Record<BuildPhase, string> = {
    preparing: 'Preparing',
    compiling: 'Compiling Scripts',
    processing_assets: 'Processing Assets',
    assembling: 'Assembling',
    writing: 'Writing Output',
    completed: 'Completed',
    failed: 'Failed',
};

const LOG_LEVEL_CLASSES: Record<string, string> = {
    info: 'progress-log-info',
    warn: 'progress-log-warn',
    error: 'progress-log-error',
    debug: 'progress-log-debug',
};

// =============================================================================
// BuildProgressPanel Class
// =============================================================================

export class BuildProgressPanel {
    private container_: HTMLDivElement | null = null;
    private progressBar_: HTMLDivElement | null = null;
    private progressText_: HTMLDivElement | null = null;
    private phaseText_: HTMLDivElement | null = null;
    private taskText_: HTMLDivElement | null = null;
    private timeText_: HTMLDivElement | null = null;
    private logContainer_: HTMLDivElement | null = null;
    private cancelBtn_: HTMLButtonElement | null = null;
    private closeBtn_: HTMLButtonElement | null = null;

    private reporter_: BuildProgressReporter | null = null;
    private unsubscribe_: (() => void) | null = null;
    private onCancel_: CancelCallback | null = null;
    private autoScrollLogs_ = true;

    show(reporter: BuildProgressReporter, onCancel?: CancelCallback): void {
        this.reporter_ = reporter;
        this.onCancel_ = onCancel ?? null;

        if (!this.container_) {
            this.createPanel();
        }

        this.container_!.style.display = 'flex';
        this.updateCancelButton(true);

        this.unsubscribe_ = reporter.onProgress((progress) => {
            this.updateProgress(progress);
        });
    }

    hide(): void {
        if (this.container_) {
            this.container_.style.display = 'none';
        }
        this.cleanup();
    }

    destroy(): void {
        this.cleanup();
        if (this.container_ && this.container_.parentNode) {
            this.container_.parentNode.removeChild(this.container_);
        }
        this.container_ = null;
    }

    private cleanup(): void {
        if (this.unsubscribe_) {
            this.unsubscribe_();
            this.unsubscribe_ = null;
        }
        this.reporter_ = null;
        this.onCancel_ = null;
    }

    private createPanel(): void {
        this.container_ = document.createElement('div');
        this.container_.className = 'build-progress-panel';

        const header = document.createElement('div');
        header.className = 'build-progress-header';

        const title = document.createElement('div');
        title.className = 'build-progress-title';
        title.textContent = 'Building...';

        this.closeBtn_ = document.createElement('button');
        this.closeBtn_.className = 'build-progress-close';
        this.closeBtn_.innerHTML = '×';
        this.closeBtn_.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(this.closeBtn_);

        const phaseSection = document.createElement('div');
        phaseSection.className = 'build-progress-phase-section';

        this.phaseText_ = document.createElement('div');
        this.phaseText_.className = 'build-progress-phase';

        this.timeText_ = document.createElement('div');
        this.timeText_.className = 'build-progress-time';

        phaseSection.appendChild(this.phaseText_);
        phaseSection.appendChild(this.timeText_);

        const progressSection = document.createElement('div');
        progressSection.className = 'build-progress-bar-section';

        const progressTrack = document.createElement('div');
        progressTrack.className = 'build-progress-bar-track';

        this.progressBar_ = document.createElement('div');
        this.progressBar_.className = 'build-progress-bar-fill';

        progressTrack.appendChild(this.progressBar_);

        this.progressText_ = document.createElement('div');
        this.progressText_.className = 'build-progress-percent';
        this.progressText_.textContent = '0%';

        progressSection.appendChild(progressTrack);
        progressSection.appendChild(this.progressText_);

        this.taskText_ = document.createElement('div');
        this.taskText_.className = 'build-progress-task';

        this.logContainer_ = document.createElement('div');
        this.logContainer_.className = 'build-progress-logs';
        this.logContainer_.onscroll = () => {
            const el = this.logContainer_!;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
            this.autoScrollLogs_ = atBottom;
        };

        const footer = document.createElement('div');
        footer.className = 'build-progress-footer';

        this.cancelBtn_ = document.createElement('button');
        this.cancelBtn_.className = 'build-progress-cancel-btn';
        this.cancelBtn_.textContent = 'Cancel';
        this.cancelBtn_.onclick = () => this.handleCancel();

        footer.appendChild(this.cancelBtn_);

        this.container_.appendChild(header);
        this.container_.appendChild(phaseSection);
        this.container_.appendChild(progressSection);
        this.container_.appendChild(this.taskText_);
        this.container_.appendChild(this.logContainer_);
        this.container_.appendChild(footer);

        document.body.appendChild(this.container_);
    }

    private updateProgress(progress: BuildProgress): void {
        if (!this.container_) return;

        this.progressBar_!.style.width = `${progress.overallProgress}%`;
        this.progressText_!.textContent = `${progress.overallProgress}%`;

        this.phaseText_!.textContent = PHASE_DISPLAY_NAMES[progress.phase];
        this.taskText_!.textContent = progress.currentTask;

        const elapsed = Date.now() - progress.startTime;
        let timeText = `Elapsed: ${formatDuration(elapsed)}`;
        if (progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0) {
            timeText += ` · ~${formatDuration(progress.estimatedTimeRemaining)} remaining`;
        }
        this.timeText_!.textContent = timeText;

        this.updateLogs(progress.logs);

        if (progress.phase === 'completed') {
            this.phaseText_!.classList.add('build-progress-success');
            this.updateCancelButton(false);
        } else if (progress.phase === 'failed') {
            this.phaseText_!.classList.add('build-progress-error');
            this.progressBar_!.classList.add('build-progress-bar-error');
            this.updateCancelButton(false);
        } else {
            this.phaseText_!.classList.remove('build-progress-success', 'build-progress-error');
            this.progressBar_!.classList.remove('build-progress-bar-error');
        }
    }

    private updateLogs(logs: BuildLogEntry[]): void {
        if (!this.logContainer_) return;

        const currentCount = this.logContainer_.children.length;
        const newLogs = logs.slice(currentCount);

        for (const entry of newLogs) {
            const line = document.createElement('div');
            line.className = `build-progress-log-line ${LOG_LEVEL_CLASSES[entry.level] || ''}`;

            const time = new Date(entry.timestamp).toLocaleTimeString();
            line.innerHTML = `<span class="log-time">[${time}]</span> ${this.escapeHtml(entry.message)}`;

            this.logContainer_.appendChild(line);
        }

        if (this.autoScrollLogs_ && newLogs.length > 0) {
            this.logContainer_.scrollTop = this.logContainer_.scrollHeight;
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private updateCancelButton(canCancel: boolean): void {
        if (this.cancelBtn_) {
            this.cancelBtn_.disabled = !canCancel;
            this.cancelBtn_.textContent = canCancel ? 'Cancel' : 'Close';
            this.cancelBtn_.onclick = canCancel
                ? () => this.handleCancel()
                : () => this.hide();
        }
    }

    private handleCancel(): void {
        if (this.onCancel_) {
            this.onCancel_();
        }
    }

    isVisible(): boolean {
        return this.container_?.style.display === 'flex';
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let panelInstance: BuildProgressPanel | null = null;

export function getBuildProgressPanel(): BuildProgressPanel {
    if (!panelInstance) {
        panelInstance = new BuildProgressPanel();
    }
    return panelInstance;
}

export function showBuildProgress(
    reporter: BuildProgressReporter,
    onCancel?: CancelCallback
): void {
    getBuildProgressPanel().show(reporter, onCancel);
}

export function hideBuildProgress(): void {
    if (panelInstance) {
        panelInstance.hide();
    }
}
