// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native_audio.cpp
 * @brief   AudioEngine (see native_audio.hpp), backed by miniaudio.
 * @details This TU owns the miniaudio implementation (like host_core.cpp owns
 *          stb_image). On iOS it is compiled as Objective-C++ (the CMake build
 *          adds `-x objective-c++`) because miniaudio's CoreAudio backend touches
 *          AVAudioSession; on Android it is plain C++ and miniaudio dlopens
 *          AAudio/OpenSL at runtime. The Obj-C paths are __APPLE__-guarded inside
 *          miniaudio, so the same source compiles on both.
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING          // playback only; no encoders needed
#include "miniaudio.h"

#include "native_audio.hpp"

#include "audio_spectrum.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace eshost {

// A decoded clip. register_decoded_data() does NOT copy the PCM, so `pcm` must
// outlive every voice playing it — freed only once unloaded AND no voice remains
// (`refs` == 0), or a still-playing sound would read freed memory.
struct Buffer {
    std::string name;       // "buf://<id>", the resource-manager key
    void* pcm = nullptr;    // owned; f32 interleaved at the engine's rate/channels
    int refs = 0;           // live voices playing this buffer
    bool unloaded = false;  // SDK dropped it; free when the last voice releases
};

// One playing instance. ma_sound is a node in the engine graph and must not move,
// so voices live in a node-stable unordered_map (never reallocated on rehash).
struct Voice {
    ma_sound sound{};
    int bufferId = -1;
    bool loop = false;
};

// The analyser's tap: a node the voices play into, which passes their frames
// through unchanged and keeps a copy for the FFT. Attaching voices HERE rather
// than straight to the endpoint is what gives the game a spectrum without the
// audio thread ever waiting on it (AudioSpectrum::write is wait-free).
struct SpectrumTap {
    ma_node_base base{};
    AudioSpectrum* spectrum = nullptr;
    ma_uint32 channels = 2;
};

void spectrumTapProcess(ma_node* node, const float** framesIn, ma_uint32* frameCountIn,
                        float** framesOut, ma_uint32* frameCountOut) {
    auto* tap = reinterpret_cast<SpectrumTap*>(node);
    const ma_uint32 frames = frameCountIn && frameCountOut
        ? (*frameCountIn < *frameCountOut ? *frameCountIn : *frameCountOut) : 0;
    if (frames > 0 && framesIn && framesIn[0] && framesOut && framesOut[0]) {
        const size_t samples = (size_t)frames * tap->channels;
        for (size_t i = 0; i < samples; i++) framesOut[0][i] = framesIn[0][i];
        if (tap->spectrum) tap->spectrum->write(framesIn[0], frames, tap->channels);
    }
    if (frameCountOut) *frameCountOut = frames;
    if (frameCountIn) *frameCountIn = frames;
}

struct AudioEngine::Impl {
    ma_context context{};
    ma_engine engine{};
    SpectrumTap tap{};
    bool tapReady = false;
    AudioSpectrum spectrum;
    bool contextReady = false;
    bool ready = false;
    ma_uint32 sampleRate = 0;
    ma_uint32 channels = 0;
    std::unordered_map<int, Buffer> buffers;
    std::unordered_map<int, Voice> voices;
    int nextBuffer = 1;
    int nextVoice = 1;

    ma_sound* soundOf(int voiceId) {
        auto it = voices.find(voiceId);
        return it == voices.end() ? nullptr : &it->second.sound;
    }

    // Drop one reference to a buffer; free its PCM once it is both unloaded and
    // unreferenced. The resource-manager registration is released at unload().
    void releaseBuffer(int bufferId) {
        auto it = buffers.find(bufferId);
        if (it == buffers.end()) return;
        if (--it->second.refs <= 0 && it->second.unloaded) {
            ma_free(it->second.pcm, nullptr);
            buffers.erase(it);
        }
    }

    void destroyVoice(int voiceId) {
        auto it = voices.find(voiceId);
        if (it == voices.end()) return;
        const int bufferId = it->second.bufferId;
        ma_sound_uninit(&it->second.sound);
        voices.erase(it);
        releaseBuffer(bufferId);
    }
};

AudioEngine::~AudioEngine() { shutdown(); }

bool AudioEngine::init() {
    if (impl_) return impl_->ready;
    impl_ = new Impl();

    // Own the context so the iOS audio session is playback-only. miniaudio
    // defaults to PlayAndRecord, which opens the microphone — that needs a usage
    // permission and, on the simulator, deadlocks AURemoteIO's Initialize. A game
    // only plays out; Playback also sounds through the silent switch. Ignored by
    // the Android backends.
    ma_context_config ctxCfg = ma_context_config_init();
    ctxCfg.coreaudio.sessionCategory = ma_ios_session_category_playback;
    if (ma_context_init(nullptr, 0, &ctxCfg, &impl_->context) != MA_SUCCESS) {
        delete impl_;
        impl_ = nullptr;
        return false;
    }
    impl_->contextReady = true;

    ma_engine_config cfg = ma_engine_config_init();
    cfg.pContext = &impl_->context;
    if (ma_engine_init(&cfg, &impl_->engine) != MA_SUCCESS) {
        ma_context_uninit(&impl_->context);
        delete impl_;
        impl_ = nullptr;
        return false;
    }
    impl_->ready = true;
    impl_->sampleRate = ma_engine_get_sample_rate(&impl_->engine);
    impl_->channels = ma_engine_get_channels(&impl_->engine);

    // The analyser tap, between the voices and the endpoint. Optional: a failure
    // here costs the spectrum, not the sound.
    static ma_node_vtable vtable{};
    vtable.onProcess = spectrumTapProcess;
    vtable.onGetRequiredInputFrameCount = nullptr;
    vtable.inputBusCount = 1;
    vtable.outputBusCount = 1;
    vtable.flags = MA_NODE_FLAG_PASSTHROUGH;
    ma_node_config tapCfg = ma_node_config_init();
    tapCfg.vtable = &vtable;
    tapCfg.pInputChannels = &impl_->channels;
    tapCfg.pOutputChannels = &impl_->channels;
    impl_->tap.spectrum = &impl_->spectrum;
    impl_->tap.channels = impl_->channels;
    if (ma_node_init(ma_engine_get_node_graph(&impl_->engine), &tapCfg, nullptr,
                     &impl_->tap.base) == MA_SUCCESS
        && ma_node_attach_output_bus(&impl_->tap.base, 0,
                                     ma_engine_get_endpoint(&impl_->engine), 0) == MA_SUCCESS) {
        impl_->tapReady = true;
    }
    return true;
}

void AudioEngine::shutdown() {
    if (!impl_) return;
    for (auto& [id, voice] : impl_->voices) ma_sound_uninit(&voice.sound);
    impl_->voices.clear();
    if (impl_->tapReady) { ma_node_uninit(&impl_->tap.base, nullptr); impl_->tapReady = false; }
    if (impl_->ready) ma_engine_uninit(&impl_->engine);
    if (impl_->contextReady) ma_context_uninit(&impl_->context);
    for (auto& [id, buf] : impl_->buffers) ma_free(buf.pcm, nullptr);
    impl_->buffers.clear();
    delete impl_;
    impl_ = nullptr;
}

bool AudioEngine::ready() const { return impl_ && impl_->ready; }

AudioEngine::Loaded AudioEngine::load(const uint8_t* bytes, size_t n) {
    const Loaded fail{-1, 0.0, 0};
    if (!ready() || !bytes || n == 0) return fail;

    // Decode straight to the engine's format so playback never resamples.
    ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, impl_->channels, impl_->sampleRate);
    ma_uint64 frames = 0;
    void* pcm = nullptr;
    if (ma_decode_memory(bytes, n, &dcfg, &frames, &pcm) != MA_SUCCESS || !pcm) return fail;

    // Insert first so the name registered with the manager is the map entry's own
    // (node-stable) string — never a moved-from temporary whose SSO buffer relocates.
    const int id = impl_->nextBuffer++;
    Buffer& buf = impl_->buffers[id];
    buf.name = "buf://" + std::to_string(id);
    buf.pcm = pcm;
    if (ma_resource_manager_register_decoded_data(
            ma_engine_get_resource_manager(&impl_->engine), buf.name.c_str(),
            pcm, frames, ma_format_f32, impl_->channels, impl_->sampleRate) != MA_SUCCESS) {
        impl_->buffers.erase(id);
        ma_free(pcm, nullptr);
        return fail;
    }

    const double duration = impl_->sampleRate ? static_cast<double>(frames) / impl_->sampleRate : 0.0;
    const long long decodedBytes =
        static_cast<long long>(frames) * impl_->channels * static_cast<long long>(sizeof(float));
    return Loaded{id, duration, decodedBytes};
}

void AudioEngine::unload(int bufferId) {
    if (!impl_) return;
    auto it = impl_->buffers.find(bufferId);
    if (it == impl_->buffers.end() || it->second.unloaded) return;
    // Release the manager's own reference; live voices keep their own until they
    // end, so the PCM is freed by releaseBuffer() once the last one does.
    ma_resource_manager_unregister_data(
        ma_engine_get_resource_manager(&impl_->engine), it->second.name.c_str());
    it->second.unloaded = true;
    if (it->second.refs <= 0) {
        ma_free(it->second.pcm, nullptr);
        impl_->buffers.erase(it);
    }
}

int AudioEngine::play(int bufferId, float volume, float pan, bool loop, float rate) {
    if (!ready()) return -1;
    auto bit = impl_->buffers.find(bufferId);
    if (bit == impl_->buffers.end() || bit->second.unloaded) return -1;

    const int id = impl_->nextVoice++;
    Voice& voice = impl_->voices[id];   // node-stable: &voice.sound is fixed
    voice.bufferId = bufferId;
    voice.loop = loop;
    // Data is already decoded + registered, so init just wraps it (no decode).
    // NO_SPATIALIZATION: 2D games pan explicitly; the 3D positioner would fight it.
    if (ma_sound_init_from_file(&impl_->engine, bit->second.name.c_str(),
                                MA_SOUND_FLAG_NO_SPATIALIZATION, nullptr, nullptr,
                                &voice.sound) != MA_SUCCESS) {
        impl_->voices.erase(id);
        return -1;
    }
    // Into the tap when there is one, so the analyser sees this voice; straight
    // to the endpoint otherwise (identical audio either way).
    if (impl_->tapReady) {
        ma_node_attach_output_bus(&voice.sound, 0, &impl_->tap.base, 0);
    }
    ma_sound_set_volume(&voice.sound, volume);
    ma_sound_set_pan(&voice.sound, pan);
    ma_sound_set_pitch(&voice.sound, rate > 0 ? rate : 1.0f);
    ma_sound_set_looping(&voice.sound, loop ? MA_TRUE : MA_FALSE);
    ma_sound_start(&voice.sound);
    bit->second.refs++;
    return id;
}

bool AudioEngine::spectrum(uint8_t* out, size_t bins) {
    if (!impl_ || !impl_->tapReady) return false;
    return impl_->spectrum.read(out, bins);
}

void AudioEngine::stop(int voiceId) {
    if (impl_) impl_->destroyVoice(voiceId);
}

void AudioEngine::pause(int voiceId) {
    // ma_sound_stop pauses in place (keeps the cursor); start() resumes.
    if (ma_sound* s = impl_ ? impl_->soundOf(voiceId) : nullptr) ma_sound_stop(s);
}

void AudioEngine::resume(int voiceId) {
    if (ma_sound* s = impl_ ? impl_->soundOf(voiceId) : nullptr) ma_sound_start(s);
}

void AudioEngine::setVolume(int voiceId, float volume) {
    if (ma_sound* s = impl_ ? impl_->soundOf(voiceId) : nullptr) ma_sound_set_volume(s, volume);
}

void AudioEngine::setPan(int voiceId, float pan) {
    if (ma_sound* s = impl_ ? impl_->soundOf(voiceId) : nullptr) ma_sound_set_pan(s, pan);
}

void AudioEngine::setLoop(int voiceId, bool loop) {
    if (!impl_) return;
    auto it = impl_->voices.find(voiceId);
    if (it == impl_->voices.end()) return;
    it->second.loop = loop;
    ma_sound_set_looping(&it->second.sound, loop ? MA_TRUE : MA_FALSE);
}

void AudioEngine::setRate(int voiceId, float rate) {
    if (ma_sound* s = impl_ ? impl_->soundOf(voiceId) : nullptr) {
        ma_sound_set_pitch(s, rate > 0 ? rate : 1.0f);
    }
}

AudioEngine::VoiceState AudioEngine::voiceState(int voiceId) {
    if (!impl_) return {false, false, 0.0};
    auto it = impl_->voices.find(voiceId);
    if (it == impl_->voices.end()) return {false, false, 0.0};
    float cursor = 0;
    ma_sound_get_cursor_in_seconds(&it->second.sound, &cursor);
    return {true, ma_sound_is_playing(&it->second.sound) == MA_TRUE, static_cast<double>(cursor)};
}

void AudioEngine::suspendAll() {
    if (ready()) ma_engine_stop(&impl_->engine);
}

void AudioEngine::resumeAll() {
    if (ready()) ma_engine_start(&impl_->engine);
}

void AudioEngine::pumpEnded(const std::function<void(int)>& onEnded) {
    if (!ready()) return;
    std::vector<int> ended;
    for (auto& [id, voice] : impl_->voices) {
        if (!voice.loop && ma_sound_at_end(&voice.sound) == MA_TRUE) ended.push_back(id);
    }
    for (const int id : ended) {
        onEnded(id);                 // may synchronously play() new voices — safe (iterating a copy)
        impl_->destroyVoice(id);
    }
}

}  // namespace eshost
