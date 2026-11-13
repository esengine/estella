// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AudioBindings.cpp
 * @brief   es_audio* over the host's native engine (miniaudio).
 * @details Host-owned by nature: the engine core has no audio subsystem to
 *          generate a binding from — on the web this surface is WebAudio, and on
 *          a mini-game it is the vendor's InnerAudioContext. The SDK's
 *          NativeAudioBackend is a thin shell over exactly these calls, mirroring
 *          the WeChat backend over its host's.
 *
 *          Bound ONLY when a sound device came up, so the SDK's hasAudioBindings()
 *          gates the native backend on real availability: a host with no device
 *          binds none of them and audio falls back to the Null backend.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include <vector>

using namespace esengine;

namespace eshost {
namespace {

// es_audioLoad(ArrayBuffer | TypedArray, stream?) -> { id, duration, bytes, streamed } | null.
// The SDK hands the compressed clip bytes and says whether to stream it; the
// engine decodes + registers them, or keeps the file and decodes as it plays.
// `streamed` is what happened, which is how the SDK tells a host that streams
// from one that predates the second argument and decoded regardless.
esjs::Val js_audioLoad(const esjs::Args& a) {
    if (a.size() < 1) return esjs::null();
    std::vector<u8> bytes;
    readByteSource(a[0], bytes);
    if (bytes.empty()) return esjs::null();
    const bool stream = a.size() > 1 && esjs::toBool(a[1]);
    auto r = host().audio.load(bytes.data(), bytes.size(), stream);
    if (r.id < 0) return esjs::null();
    esjs::Val o = esjs::object();
    esjs::set(o, "id", esjs::int32(r.id));
    esjs::set(o, "duration", esjs::number(r.duration));
    esjs::set(o, "bytes", esjs::int64(r.bytes));
    esjs::set(o, "streamed", esjs::boolean(r.streamed));
    return o;
}

esjs::Val js_audioUnload(const esjs::Args& a) {
    int32_t id = esjs::toInt32(a[0]);
    host().audio.unload(id);
    return esjs::undefined();
}

// es_audioPlay(bufferId, volume, pan, loop, rate, loopStart?) -> voiceId (-1 if unknown).
// loopStart is seconds a looping voice comes back to in place of its start.
esjs::Val js_audioPlay(const esjs::Args& a) {
    int32_t buf = esjs::toInt32(a[0]);
    double vol = 1, pan = 0, rate = 1;
    if (a.size() > 1) vol = esjs::toNumber(a[1]);
    if (a.size() > 2) pan = esjs::toNumber(a[2]);
    const bool loop = a.size() > 3 && esjs::toBool(a[3]);
    if (a.size() > 4) rate = esjs::toNumber(a[4]);
    double loopStart = 0;
    if (a.size() > 5) loopStart = esjs::toNumber(a[5]);
    return esjs::int32(host().audio.play(buf, (f32)vol, (f32)pan, loop, (f32)rate, (f32)loopStart));
}

// The voice-scoped commands all take the voice id as a[0].
int32_t voiceArg(const esjs::Args& a) {
    int32_t v = esjs::toInt32(a[0]); return v;
}
esjs::Val js_audioStop(const esjs::Args& a) {
    host().audio.stop(voiceArg(a)); return esjs::undefined();
}
esjs::Val js_audioPause(const esjs::Args& a) {
    host().audio.pause(voiceArg(a)); return esjs::undefined();
}
esjs::Val js_audioResume(const esjs::Args& a) {
    host().audio.resume(voiceArg(a)); return esjs::undefined();
}
esjs::Val js_audioSetVolume(const esjs::Args& a) {
    double v = esjs::toNumber(a[1]);
    host().audio.setVolume(voiceArg(a), (f32)v); return esjs::undefined();
}
esjs::Val js_audioSetPan(const esjs::Args& a) {
    double p = esjs::toNumber(a[1]);
    host().audio.setPan(voiceArg(a), (f32)p); return esjs::undefined();
}
esjs::Val js_audioSetLoop(const esjs::Args& a) {
    host().audio.setLoop(voiceArg(a), esjs::toBool(a[1])); return esjs::undefined();
}
esjs::Val js_audioSetRate(const esjs::Args& a) {
    double r = esjs::toNumber(a[1]);
    host().audio.setRate(voiceArg(a), (f32)r); return esjs::undefined();
}

// es_audioVoiceState(voiceId) -> { playing, currentTime } | null (null once ended).
esjs::Val js_audioVoiceState(const esjs::Args& a) {
    auto st = host().audio.voiceState(voiceArg(a));
    if (!st.valid) return esjs::null();
    esjs::Val o = esjs::object();
    esjs::set(o, "playing", esjs::boolean(st.playing));
    esjs::set(o, "currentTime", esjs::number(st.currentTime));
    return o;
}
esjs::Val js_audioSuspendAll(const esjs::Args& a) {
    host().audio.suspendAll(); return esjs::undefined();
}
esjs::Val js_audioResumeAll(const esjs::Args& a) {
    host().audio.resumeAll(); return esjs::undefined();
}
esjs::Val js_audioDebugFault(const esjs::Args& a) {
    host().audio.debugFault(a.size() > 0 ? esjs::toInt32(a[0]) : 0); return esjs::undefined();
}

}  // namespace

// es_audioSpectrum(bins) -> ArrayBuffer of `bins` magnitude bytes, or null when
// nothing has played yet. The device's answer to a WebAudio AnalyserNode.
esjs::Val js_audioSpectrum(const esjs::Args& a) {
    if (a.size() < 1 || !hostAlive()) return esjs::null();
    int32_t bins = 0;
    bins = esjs::toInt32(a[0]);
    if (bins <= 0 || bins > 4096) return esjs::null();
    std::vector<uint8_t> out((size_t)bins, 0);
    if (!host().audio.spectrum(out.data(), out.size())) return esjs::null();
    return esjs::arrayBufferCopy(out.data(), out.size());
}

void registerAudioBindings(HostState& h, esjs::Val global) {
    if (!h.audio.ready()) return;
    bindGlobal(global, "es_audioLoad", js_audioLoad, 2);
    bindGlobal(global, "es_audioUnload", js_audioUnload, 1);
    bindGlobal(global, "es_audioPlay", js_audioPlay, 6);
    bindGlobal(global, "es_audioStop", js_audioStop, 1);
    bindGlobal(global, "es_audioPause", js_audioPause, 1);
    bindGlobal(global, "es_audioResume", js_audioResume, 1);
    bindGlobal(global, "es_audioSetVolume", js_audioSetVolume, 2);
    bindGlobal(global, "es_audioSetPan", js_audioSetPan, 2);
    bindGlobal(global, "es_audioSetLoop", js_audioSetLoop, 2);
    bindGlobal(global, "es_audioSpectrum", js_audioSpectrum, 1);
    bindGlobal(global, "es_audioSetRate", js_audioSetRate, 2);
    bindGlobal(global, "es_audioVoiceState", js_audioVoiceState, 1);
    bindGlobal(global, "es_audioSuspendAll", js_audioSuspendAll, 0);
    bindGlobal(global, "es_audioResumeAll", js_audioResumeAll, 0);
    bindGlobal(global, "es_audioDebugFault", js_audioDebugFault, 1);
}

}  // namespace eshost
