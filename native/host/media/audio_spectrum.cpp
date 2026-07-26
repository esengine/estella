// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio_spectrum.cpp
 * @brief   Implements the device's spectrum analyser (see audio_spectrum.hpp).
 */
#include "audio_spectrum.hpp"

#include <algorithm>
#include <cmath>

namespace eshost {
namespace {

constexpr float kPi = 3.14159265358979323846f;

/** In-place radix-2 Cooley-Tukey FFT. `n` is a power of two. */
void fft(float* re, float* im, size_t n) {
    // Bit-reversal permutation.
    for (size_t i = 1, j = 0; i < n; i++) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            std::swap(re[i], re[j]);
            std::swap(im[i], im[j]);
        }
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const float angle = -2.0f * kPi / (float)len;
        const float wr = std::cos(angle);
        const float wi = std::sin(angle);
        for (size_t i = 0; i < n; i += len) {
            float cr = 1.0f, ci = 0.0f;
            for (size_t k = 0; k < len / 2; k++) {
                const size_t a = i + k;
                const size_t b = a + len / 2;
                const float xr = re[b] * cr - im[b] * ci;
                const float xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
                const float nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

}  // namespace

void AudioSpectrum::write(const float* frames, size_t frameCount, uint32_t channels) {
    if (!frames || frameCount == 0 || channels == 0) return;
    uint32_t index = writeIndex_.load(std::memory_order_relaxed);
    for (size_t f = 0; f < frameCount; f++) {
        float sum = 0.0f;
        for (uint32_t c = 0; c < channels; c++) sum += frames[f * channels + c];
        ring_[index & (kWindow - 1)] = sum / (float)channels;
        index++;
    }
    writeIndex_.store(index, std::memory_order_release);
    everWrote_.store(true, std::memory_order_release);
}

bool AudioSpectrum::read(uint8_t* out, size_t bins) {
    if (!out || bins == 0) return false;
    if (!everWrote_.load(std::memory_order_acquire)) return false;

    re_.assign(kWindow, 0.0f);
    im_.assign(kWindow, 0.0f);
    // Oldest-to-newest, Hann-windowed: the window kills the spectral leakage a
    // hard-cut buffer would smear across every bin.
    const uint32_t end = writeIndex_.load(std::memory_order_acquire);
    for (size_t i = 0; i < kWindow; i++) {
        const float sample = ring_[(end + i) & (kWindow - 1)];
        const float w = 0.5f * (1.0f - std::cos(2.0f * kPi * (float)i / (float)(kWindow - 1)));
        re_[i] = sample * w;
    }
    fft(re_.data(), im_.data(), kWindow);

    // Byte magnitudes over 0..Nyquist, in decibels — the scale the web's
    // getByteFrequencyData uses, so a visualizer looks the same on both.
    constexpr float kMinDb = -90.0f;
    constexpr float kMaxDb = -20.0f;
    const size_t usable = kWindow / 2;
    for (size_t b = 0; b < bins; b++) {
        // Each output bin averages the FFT bins it covers, so a short bar array
        // still reflects the whole band rather than sampling it.
        const size_t from = b * usable / bins;
        const size_t to = std::max(from + 1, (b + 1) * usable / bins);
        float sum = 0.0f;
        for (size_t k = from; k < to && k < usable; k++) {
            sum += std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]);
        }
        const float mag = sum / (float)(to - from) / (float)(kWindow / 4);
        const float db = 20.0f * std::log10(std::max(mag, 1e-7f));
        const float t = (db - kMinDb) / (kMaxDb - kMinDb);
        out[b] = (uint8_t)std::clamp(t * 255.0f, 0.0f, 255.0f);
    }
    return true;
}

}  // namespace eshost
