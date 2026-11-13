// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native_audio.hpp
 * @brief   The native audio engine behind the host's es_audio* bindings.
 * @details One cross-platform implementation (miniaudio: CoreAudio on iOS,
 *          AAudio/OpenSL on Android) — decode, mixing and output all run here in
 *          C, never per-sample in the JS engine (the no-JIT budget forbids that).
 *          The SDK's NativeAudioBackend is a thin shell over the es_audio*
 *          bindings, which in turn are a thin shell over this.
 *
 *          A buffer id names a loaded clip; a voice id names one playing
 *          instance. A clip is held one of two ways: decoded to PCM, which starts
 *          with no delay and costs its whole length in memory (0.37 MB a second),
 *          or streamed, which keeps the compressed file and decodes each voice as
 *          it plays — what music and anything else long wants. The miniaudio header is kept out of this interface (pimpl),
 *          so host_core.cpp does not pay to compile it.
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>

namespace eshost {

class AudioEngine {
public:
    AudioEngine() = default;
    ~AudioEngine();
    AudioEngine(const AudioEngine&) = delete;
    AudioEngine& operator=(const AudioEngine&) = delete;

    /** Bring up the audio device. Returns false (and stays silent) if none is
     *  available — a game with no sound still runs. */
    bool init();
    void shutdown();
    bool ready() const;

    struct Loaded {
        int id;             ///< < 0 on decode failure.
        double duration;    ///< Seconds; 0 when a streamed file does not say.
        long long bytes;    ///< What stays resident: the PCM, or the compressed file when streamed.
        bool streamed;      ///< Held compressed and decoded while it plays.
    };
    /**
     * Register a compressed clip: decoded to PCM now, or with @p stream kept as it
     * is and decoded by each voice as it plays. A file that cannot be streamed is
     * decoded instead, and `streamed` says which happened.
     */
    Loaded load(const uint8_t* bytes, size_t n, bool stream = false);
    void unload(int bufferId);

    /**
     * Fill @p bins byte magnitudes of what is playing, 0..Nyquist — the device's
     * answer to a WebAudio AnalyserNode (see media/audio_spectrum.hpp). False
     * when nothing has played yet or the tap could not be built.
     */
    bool spectrum(uint8_t* out, size_t bins);

    /** Start a voice on a loaded buffer. Returns its id, or -1 if unknown. */
    /// @p loopStart: seconds a looping voice comes back to at its end, so what is before it is heard once. 0 is its start.
    /// @p start, @p end: where the clip begins and is over in what was decoded, in seconds (end 0 is its natural end):
    /// a clip the exporter re-encoded has silence before it and after it, and is played without either.
    /// @p at: a moment of time() that the voice begins on, 0 for now. Voices given the same moment begin on the same
    /// frame, which calls arriving one after another cannot otherwise promise.
    int play(int bufferId, float volume, float pan, bool loop, float rate, float loopStart = 0.0f, float start = 0.0f, float end = 0.0f, double at = 0.0);
    /// The engine's clock, in seconds since it started.
    double time() const;
    void stop(int voiceId);
    void pause(int voiceId);
    void resume(int voiceId);
    void setVolume(int voiceId, float volume);
    void setPan(int voiceId, float pan);
    void setLoop(int voiceId, bool loop);
    void setRate(int voiceId, float rate);

    struct VoiceState {
        bool valid;         ///< False once the voice has ended or was never known.
        bool playing;
        double currentTime; ///< Seconds.
    };
    VoiceState voiceState(int voiceId);

    /** Pause / resume the whole device — the app backgrounding and returning. */
    void suspendAll();
    void resumeAll();

    struct Health {
        int attempt = 0;
        double silentMs = 0.0;
        bool rebuilt = false;
        bool started = false;
        bool recovered = false;
    };
    Health maintain();
    void debugFault(int kind);

    /** Report every non-looping voice that ended on its own since the last call,
     *  then free it. Runs on the game thread each frame — miniaudio's public API
     *  is game-thread safe, so the notification reaches JS with no cross-thread
     *  hop into the JS engine. */
    void pumpEnded(const std::function<void(int)>& onEnded);

    struct Impl;

private:
    Impl* impl_ = nullptr;
};

}  // namespace eshost
