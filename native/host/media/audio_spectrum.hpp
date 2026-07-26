// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio_spectrum.hpp
 * @brief   The analyser behind `AudioAPI.getSpectrum()` on a device: a tap on
 *          what the engine is about to play, and the FFT over it.
 * @details The web reads its spectrum from a WebAudio AnalyserNode. There is no
 *          such node here, so the host provides the same answer the same way a
 *          browser does — window the most recent frames, transform them, and
 *          hand back byte magnitudes in the layout getByteFrequencyData uses.
 *
 *          Thread-safe by design: the audio thread only ever WRITES into a ring
 *          buffer, and the game thread only ever reads a snapshot of it, so no
 *          lock sits in the audio callback (where one would be a dropout).
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace eshost {

/**
 * A rolling window of the engine's output, and the FFT over it.
 *
 * `write` is called from the audio thread with interleaved frames; `read` is
 * called from the game thread and fills `out` with `out.size()` magnitude bytes
 * covering 0 .. Nyquist, exactly like the web's getByteFrequencyData.
 */
class AudioSpectrum {
public:
    /** Samples the FFT runs over. 1024 at 48 kHz is ~21 ms — long enough to
     *  resolve a bass line, short enough to look live. */
    static constexpr size_t kWindow = 1024;

    /** Mix `frameCount` interleaved frames down to mono and keep the newest
     *  window. Audio thread; wait-free. */
    void write(const float* frames, size_t frameCount, uint32_t channels);

    /** Fill `out` with byte magnitudes. False when nothing has played yet, so a
     *  caller can tell "silent" from "unsupported". Game thread. */
    bool read(uint8_t* out, size_t bins);

private:
    /** Power-of-two ring of mono samples the audio thread writes into. */
    float ring_[kWindow]{};
    std::atomic<uint32_t> writeIndex_{0};
    std::atomic<bool> everWrote_{false};
    /** Scratch for the transform — game thread only, so no allocation per read. */
    std::vector<float> re_;
    std::vector<float> im_;
};

}  // namespace eshost
