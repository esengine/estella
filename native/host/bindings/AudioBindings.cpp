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

using namespace esengine;

namespace eshost {
namespace {

// es_audioLoad(ArrayBuffer | TypedArray) -> { id, duration, bytes } | null. The
// SDK hands the compressed clip bytes; the engine decodes + registers them.
JSValue js_audioLoad(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NULL;
    std::vector<u8> bytes;
    readByteSource(ctx, argv[0], bytes);
    if (bytes.empty()) return JS_NULL;
    auto r = host().audio.load(bytes.data(), bytes.size());
    if (r.id < 0) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, r.id));
    JS_SetPropertyStr(ctx, o, "duration", JS_NewFloat64(ctx, r.duration));
    JS_SetPropertyStr(ctx, o, "bytes", JS_NewInt64(ctx, r.bytes));
    return o;
}

JSValue js_audioUnload(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int32_t id = 0; JS_ToInt32(ctx, &id, argv[0]);
    host().audio.unload(id);
    return JS_UNDEFINED;
}

// es_audioPlay(bufferId, volume, pan, loop, rate) -> voiceId (-1 if unknown).
JSValue js_audioPlay(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int32_t buf = 0; JS_ToInt32(ctx, &buf, argv[0]);
    double vol = 1, pan = 0, rate = 1;
    if (argc > 1) JS_ToFloat64(ctx, &vol, argv[1]);
    if (argc > 2) JS_ToFloat64(ctx, &pan, argv[2]);
    const bool loop = argc > 3 && JS_ToBool(ctx, argv[3]);
    if (argc > 4) JS_ToFloat64(ctx, &rate, argv[4]);
    return JS_NewInt32(ctx, host().audio.play(buf, (f32)vol, (f32)pan, loop, (f32)rate));
}

// The voice-scoped commands all take the voice id as argv[0].
int32_t voiceArg(JSContext* ctx, JSValueConst* argv) {
    int32_t v = 0; JS_ToInt32(ctx, &v, argv[0]); return v;
}
JSValue js_audioStop(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    host().audio.stop(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioPause(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    host().audio.pause(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioResume(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    host().audio.resume(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioSetVolume(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double v = 1; JS_ToFloat64(ctx, &v, argv[1]);
    host().audio.setVolume(voiceArg(ctx, argv), (f32)v); return JS_UNDEFINED;
}
JSValue js_audioSetPan(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double p = 0; JS_ToFloat64(ctx, &p, argv[1]);
    host().audio.setPan(voiceArg(ctx, argv), (f32)p); return JS_UNDEFINED;
}
JSValue js_audioSetLoop(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    host().audio.setLoop(voiceArg(ctx, argv), JS_ToBool(ctx, argv[1]) != 0); return JS_UNDEFINED;
}
JSValue js_audioSetRate(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double r = 1; JS_ToFloat64(ctx, &r, argv[1]);
    host().audio.setRate(voiceArg(ctx, argv), (f32)r); return JS_UNDEFINED;
}

// es_audioVoiceState(voiceId) -> { playing, currentTime } | null (null once ended).
JSValue js_audioVoiceState(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto st = host().audio.voiceState(voiceArg(ctx, argv));
    if (!st.valid) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "playing", JS_NewBool(ctx, st.playing));
    JS_SetPropertyStr(ctx, o, "currentTime", JS_NewFloat64(ctx, st.currentTime));
    return o;
}
JSValue js_audioSuspendAll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    host().audio.suspendAll(); return JS_UNDEFINED;
}
JSValue js_audioResumeAll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    host().audio.resumeAll(); return JS_UNDEFINED;
}

}  // namespace

void registerAudioBindings(HostState& h, JSValue global) {
    if (!h.audio.ready()) return;
    bindGlobal(h, global, "es_audioLoad", js_audioLoad, 1);
    bindGlobal(h, global, "es_audioUnload", js_audioUnload, 1);
    bindGlobal(h, global, "es_audioPlay", js_audioPlay, 5);
    bindGlobal(h, global, "es_audioStop", js_audioStop, 1);
    bindGlobal(h, global, "es_audioPause", js_audioPause, 1);
    bindGlobal(h, global, "es_audioResume", js_audioResume, 1);
    bindGlobal(h, global, "es_audioSetVolume", js_audioSetVolume, 2);
    bindGlobal(h, global, "es_audioSetPan", js_audioSetPan, 2);
    bindGlobal(h, global, "es_audioSetLoop", js_audioSetLoop, 2);
    bindGlobal(h, global, "es_audioSetRate", js_audioSetRate, 2);
    bindGlobal(h, global, "es_audioVoiceState", js_audioVoiceState, 1);
    bindGlobal(h, global, "es_audioSuspendAll", js_audioSuspendAll, 0);
    bindGlobal(h, global, "es_audioResumeAll", js_audioResumeAll, 0);
}

}  // namespace eshost
