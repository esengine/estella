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
 *          A buffer id names a decoded clip; a voice id names one playing
 *          instance. The miniaudio header is kept out of this interface (pimpl),
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
        double duration;    ///< Seconds.
        long long bytes;    ///< Decoded PCM size, for the residency budget.
    };
    /** Decode a compressed clip to PCM and register it. */
    Loaded load(const uint8_t* bytes, size_t n);
    void unload(int bufferId);

    /**
     * Fill @p bins byte magnitudes of what is playing, 0..Nyquist — the device's
     * answer to a WebAudio AnalyserNode (see media/audio_spectrum.hpp). False
     * when nothing has played yet or the tap could not be built.
     */
    bool spectrum(uint8_t* out, size_t bins);

    /** Start a voice on a loaded buffer. Returns its id, or -1 if unknown. */
    int play(int bufferId, float volume, float pan, bool loop, float rate);
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

    /** Report every non-looping voice that ended on its own since the last call,
     *  then free it. Runs on the game thread each frame — miniaudio's public API
     *  is game-thread safe, so the notification reaches JS with no cross-thread
     *  hop into QuickJS. */
    void pumpEnded(const std::function<void(int)>& onEnded);

private:
    struct Impl;
    Impl* impl_ = nullptr;
};

}  // namespace eshost
