// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    recorder.ts
 * @brief   Screen recording and clip sharing as an engine service.
 *
 * One call starts a recording, one stops it, `highlight()` keeps the moment
 * that just happened, and `share()` publishes the clip. WeChat keeps the video
 * and shares it itself, Douyin hands over a file, a browser (the editor's play
 * mode, a web dev build) records a preview it cannot publish — which is why
 * `available` and `canShare` are separate questions.
 */
import {
    defineResource, platformScreenRecorder,
    type PlatformRecording, type PlatformRecordingShareOptions, type PlatformScreenRecorder,
} from 'esengine';

export type Recording = PlatformRecording;
export type RecordingShareCard = PlatformRecordingShareOptions;
export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

export interface RecordOptions {
    /** Nothing past this is recorded; the recording still waits for `stop()`.
     *  Default 300 — the most Douyin allows. Kept inside the host's `limits`. */
    maxSeconds?: number;
}

const DEFAULT_MAX_SECONDS = 300;

export class RecorderAPI {
    private state_: RecorderState = 'idle';
    private last_: Recording | null = null;
    private readonly failureListeners_ = new Set<(error: Error) => void>();

    /** Whether this host can record at all — what a game reads to hide its
     *  record button rather than show one that fails. */
    get available(): boolean {
        return this.host_() !== null;
    }

    /** Whether a finished recording can be published from here. False in a
     *  browser, which records a preview and has nowhere to send it. */
    get canShare(): boolean {
        return this.host_()?.canShare ?? false;
    }

    get state(): RecorderState {
        return this.state_;
    }

    /** The recording length this host accepts, in seconds; null where there is no recorder. */
    get limits(): PlatformScreenRecorder['limits'] | null {
        return this.host_()?.limits ?? null;
    }

    /** The most recent finished recording — what `share()` sends by default. */
    get last(): Recording | null {
        return this.last_;
    }

    /** Hear a recording that ended on its own (the host failed, the device
     *  refused). Returns the unsubscribe. */
    onFailure(listener: (error: Error) => void): () => void {
        this.failureListeners_.add(listener);
        return () => { this.failureListeners_.delete(listener); };
    }

    async start(options: RecordOptions = {}): Promise<void> {
        const host = this.require_();
        if (this.state_ !== 'idle') throw new Error(`cannot start while ${this.state_}`);
        const { minSeconds, maxSeconds } = host.limits;
        const seconds = Math.min(maxSeconds, Math.max(minSeconds, options.maxSeconds ?? DEFAULT_MAX_SECONDS));
        this.state_ = 'starting';
        try {
            await host.start(seconds, (error) => this.failed_(error));
            this.state_ = 'recording';
        } catch (e) {
            this.state_ = 'idle';
            throw e;
        }
    }

    async pause(): Promise<void> {
        if (this.state_ !== 'recording') throw new Error(`cannot pause while ${this.state_}`);
        await this.require_().pause();
        this.state_ = 'paused';
    }

    async resume(): Promise<void> {
        if (this.state_ !== 'paused') throw new Error(`cannot resume while ${this.state_}`);
        await this.require_().resume();
        this.state_ = 'recording';
    }

    /** Finish the recording. It becomes `last`, and `share()` can send it. */
    async stop(): Promise<Recording> {
        if (this.state_ !== 'recording' && this.state_ !== 'paused') {
            throw new Error(`cannot stop while ${this.state_}`);
        }
        this.state_ = 'stopping';
        try {
            const recording = await this.require_().stop();
            this.last_ = recording;
            return recording;
        } finally {
            this.state_ = 'idle';
        }
    }

    /** Drop the recording in progress; `last` is left as it was. */
    async abort(): Promise<void> {
        if (this.state_ !== 'recording' && this.state_ !== 'paused') return;
        this.state_ = 'stopping';
        try {
            await this.require_().abort();
        } finally {
            this.state_ = 'idle';
        }
    }

    /**
     * Keep the moment that just happened: `beforeSeconds` before now and
     * `afterSeconds` after it. With any highlights, `share()` sends only them,
     * in order; without, the whole recording. Ignored when not recording.
     */
    highlight(beforeSeconds = 3, afterSeconds = 3): void {
        if (this.state_ !== 'recording') return;
        this.host_()?.highlight(beforeSeconds, afterSeconds);
    }

    /**
     * Publish a recording (default: `last`). Call it from the player's tap —
     * both hosts refuse a share nobody asked for. Rejects with the host's own
     * reason, `code` included where the host gave one.
     */
    share(card: RecordingShareCard = {}, recording: Recording | null = this.last_): Promise<void> {
        const host = this.host_();
        if (!host?.canShare) return Promise.reject(new Error('this platform cannot share a recording — check Recorder.canShare'));
        if (!recording) return Promise.reject(new Error('nothing has been recorded yet'));
        return host.share(recording, card);
    }

    private host_(): PlatformScreenRecorder | null {
        return platformScreenRecorder();
    }

    private require_(): PlatformScreenRecorder {
        const host = this.host_();
        if (!host) throw new Error('this platform cannot record — check Recorder.available');
        return host;
    }

    private failed_(error: Error): void {
        this.state_ = 'idle';
        for (const listener of this.failureListeners_) listener(error);
    }
}

export const Recorder = defineResource<RecorderAPI>(null!, 'Recorder');
