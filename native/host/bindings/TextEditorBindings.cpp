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

std::string argString(esjs::Val v) { return esjs::toString(v); }

int argInt(esjs::Val v) { return esjs::toInt32(v); }

// es_textEditor_focus(value, selectionStart, selectionEnd, multiline, maxLength, password)
esjs::Val js_textEditor_focus(const esjs::Args& a) {
    if (a.size() < 6 || !hostAlive() || !host().platform) return esjs::undefined();
    host().platform->textEditorFocus(argString(a[0]), argInt(a[1]),
                                     argInt(a[2]), esjs::toBool(a[3]),
                                     argInt(a[4]), esjs::toBool(a[5]));
    return esjs::undefined();
}

esjs::Val js_textEditor_blur(const esjs::Args&) {
    if (hostAlive() && host().platform) host().platform->textEditorBlur();
    return esjs::undefined();
}

// es_textEditor_write(value, selectionStart, selectionEnd)
esjs::Val js_textEditor_write(const esjs::Args& a) {
    if (a.size() < 3 || !hostAlive() || !host().platform) return esjs::undefined();
    host().platform->textEditorWrite(argString(a[0]), argInt(a[1]),
                                     argInt(a[2]));
    return esjs::undefined();
}

/** The push as the SDK's `es_onNativeTextEditor` reads it. */
esjs::Val makePush(const EditorPush& item) {
    esjs::Val obj = esjs::object();
    switch (item.kind) {
        case EditorPush::Kind::State:
            esjs::set(obj, "kind", esjs::string("state"));
            esjs::set(obj, "value", esjs::string(item.value.c_str()));
            esjs::set(obj, "selectionStart", esjs::int32(item.selectionStart));
            esjs::set(obj, "selectionEnd", esjs::int32(item.selectionEnd));
            esjs::set(obj, "composing", esjs::boolean(item.composing));
            break;
        case EditorPush::Kind::Submit:
            esjs::set(obj, "kind", esjs::string("submit"));
            break;
        case EditorPush::Kind::Cancel:
            esjs::set(obj, "kind", esjs::string("cancel"));
            break;
    }
    return obj;
}

}  // namespace

void drainTextEditor(HostState& h) {
    std::queue<EditorPush> pending;
    { std::lock_guard<std::mutex> lk(g_mutex); pending.swap(g_queue); }
    if (pending.empty()) return;
    (void)h;
    esjs::Enter enter;
    const esjs::Val fn = esjs::get(esjs::global(), "es_onNativeTextEditor");
    while (!pending.empty()) {
        const EditorPush item = std::move(pending.front());
        pending.pop();
        if (!esjs::isFunction(fn)) continue;   // the SDK has not installed it (yet)
        esjs::Scope scope;
        const esjs::Val arg = makePush(item);
        esjs::call(fn, esjs::undefined(), 1, &arg, "es_onNativeTextEditor");
    }
}

void registerTextEditorBindings(HostState& h, esjs::Val global) {
    // Only when the platform has a keyboard: the SDK treats the entry points as
    // an all-or-nothing group, so a half-bound host has no surface at all rather
    // than one that opens a keyboard nobody reads.
    if (!h.platform || !h.platform->hasTextEditor()) return;
    bindGlobal(global, "es_textEditor_focus", js_textEditor_focus, 6);
    bindGlobal(global, "es_textEditor_blur", js_textEditor_blur, 0);
    bindGlobal(global, "es_textEditor_write", js_textEditor_write, 3);
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
