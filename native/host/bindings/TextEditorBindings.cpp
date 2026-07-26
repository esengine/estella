// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TextEditorBindings.cpp
 * @brief   es_textEditor_* over the platform's soft keyboard, and the
 *          thread-safe hand-back that makes it usable from JS.
 * @details Host-owned, and for the same reason networking is: the editing surface
 *          IS the OS — its keyboard layouts, its IME, its candidate window. The
 *          SDK asks for one through a single contract (PlatformTextEditor); this
 *          is the device's side of it.
 *
 *          The keyboard reports on the OS UI thread, which is not the JS thread,
 *          so a report is queued as POD and drained in the frame loop — the same
 *          shape {@link deliverFetch} uses, and for the same reason: no JS value
 *          is ever touched off-thread.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include <mutex>
#include <queue>
#include <string>
#include <utility>

using namespace esengine;

namespace eshost {
namespace {

/** One thing the surface did, as POD — what crosses the thread boundary. */
struct EditorPush {
    enum class Kind { State, Submit, Cancel };
    Kind kind = Kind::State;
    std::string value;
    int selectionStart = 0;
    int selectionEnd = 0;
    bool composing = false;
};

// Namespace-scope, so the deliver* functions (which the glue calls from the UI
// thread) are safe before boot and after teardown alike.
std::mutex g_mutex;
std::queue<EditorPush> g_queue;

void push(EditorPush item) {
    std::lock_guard<std::mutex> lk(g_mutex);
    g_queue.push(std::move(item));
}

std::string argString(JSContext* ctx, JSValueConst v) {
    std::string out;
    if (const char* s = JS_ToCString(ctx, v)) {
        out = s;
        JS_FreeCString(ctx, s);
    }
    return out;
}

int argInt(JSContext* ctx, JSValueConst v) {
    int32_t out = 0;
    JS_ToInt32(ctx, &out, v);
    return out;
}

// es_textEditor_focus(value, selectionStart, selectionEnd, multiline, maxLength, password)
JSValue js_textEditor_focus(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 6 || !hostAlive() || !host().platform) return JS_UNDEFINED;
    host().platform->textEditorFocus(argString(ctx, argv[0]), argInt(ctx, argv[1]),
                                     argInt(ctx, argv[2]), JS_ToBool(ctx, argv[3]) != 0,
                                     argInt(ctx, argv[4]), JS_ToBool(ctx, argv[5]) != 0);
    return JS_UNDEFINED;
}

JSValue js_textEditor_blur(JSContext*, JSValueConst, int, JSValueConst*) {
    if (hostAlive() && host().platform) host().platform->textEditorBlur();
    return JS_UNDEFINED;
}

// es_textEditor_write(value, selectionStart, selectionEnd)
JSValue js_textEditor_write(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 3 || !hostAlive() || !host().platform) return JS_UNDEFINED;
    host().platform->textEditorWrite(argString(ctx, argv[0]), argInt(ctx, argv[1]),
                                     argInt(ctx, argv[2]));
    return JS_UNDEFINED;
}

/** The push as the SDK's `es_onNativeTextEditor` reads it. */
JSValue makePush(HostState& h, const EditorPush& item) {
    JSValue obj = JS_NewObject(h.js);
    switch (item.kind) {
        case EditorPush::Kind::State:
            JS_SetPropertyStr(h.js, obj, "kind", JS_NewString(h.js, "state"));
            JS_SetPropertyStr(h.js, obj, "value", JS_NewString(h.js, item.value.c_str()));
            JS_SetPropertyStr(h.js, obj, "selectionStart", JS_NewInt32(h.js, item.selectionStart));
            JS_SetPropertyStr(h.js, obj, "selectionEnd", JS_NewInt32(h.js, item.selectionEnd));
            JS_SetPropertyStr(h.js, obj, "composing", JS_NewBool(h.js, item.composing));
            break;
        case EditorPush::Kind::Submit:
            JS_SetPropertyStr(h.js, obj, "kind", JS_NewString(h.js, "submit"));
            break;
        case EditorPush::Kind::Cancel:
            JS_SetPropertyStr(h.js, obj, "kind", JS_NewString(h.js, "cancel"));
            break;
    }
    return obj;
}

}  // namespace

void drainTextEditor(HostState& h) {
    std::queue<EditorPush> pending;
    { std::lock_guard<std::mutex> lk(g_mutex); pending.swap(g_queue); }
    if (pending.empty()) return;

    JSValue global = JS_GetGlobalObject(h.js);
    JSValue fn = JS_GetPropertyStr(h.js, global, "es_onNativeTextEditor");
    while (!pending.empty()) {
        const EditorPush item = std::move(pending.front());
        pending.pop();
        if (!JS_IsFunction(h.js, fn)) continue;   // the SDK has not installed it (yet)
        JSValue arg = makePush(h, item);
        JSValue ret = JS_Call(h.js, fn, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) logJsError(h.js, "es_onNativeTextEditor");
        JS_FreeValue(h.js, ret);
        JS_FreeValue(h.js, arg);
    }
    JS_FreeValue(h.js, fn);
    JS_FreeValue(h.js, global);
}

void registerTextEditorBindings(HostState& h, JSValue global) {
    // Only when the platform has a keyboard: the SDK treats the entry points as
    // an all-or-nothing group, so a half-bound host has no surface at all rather
    // than one that opens a keyboard nobody reads.
    if (!h.platform || !h.platform->hasTextEditor()) return;
    bindGlobal(h, global, "es_textEditor_focus", js_textEditor_focus, 6);
    bindGlobal(h, global, "es_textEditor_blur", js_textEditor_blur, 0);
    bindGlobal(h, global, "es_textEditor_write", js_textEditor_write, 3);
}

// Thread-safe: the platform reports from its UI thread, the frame loop delivers.
void deliverTextEditorState(std::string value, int selectionStart, int selectionEnd, bool composing) {
    push({EditorPush::Kind::State, std::move(value), selectionStart, selectionEnd, composing});
}

void deliverTextEditorSubmit() {
    push({EditorPush::Kind::Submit, {}, 0, 0, false});
}

void deliverTextEditorCancel() {
    push({EditorPush::Kind::Cancel, {}, 0, 0, false});
}

}  // namespace eshost
