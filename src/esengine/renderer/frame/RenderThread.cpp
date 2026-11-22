// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderThread.hpp"

#ifdef ES_RENDER_THREADS
#include <cassert>
#include <cstdlib>
#include <exception>
#include <utility>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#include <emscripten/threading.h>
#endif

namespace esengine {

thread_local RenderThread* RenderThread::current_ = nullptr;

RenderThread::~RenderThread() { stop(); }

bool RenderThread::start(const char* canvas) {
    if (started_) return true;
    stopping_ = false;
#ifdef __EMSCRIPTEN__
    if (!emscripten_has_threading_support()) return false;
    proxy_ = em_proxying_queue_create();
    if (!proxy_) return false;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    if (canvas) emscripten_pthread_attr_settransferredcanvases(&attr, canvas);
    const int error = pthread_create(&worker_, &attr, webEntry, this);
    pthread_attr_destroy(&attr);
    if (error) {
        em_proxying_queue_destroy(proxy_);
        proxy_ = nullptr;
        return false;
    }
#else
    (void)canvas;
    worker_ = std::thread([this] {
        current_ = this;
        std::unique_lock lock(mutex_);
        for (;;) {
            changed_.wait(lock, [&] { return stopping_ || !pending_.empty(); });
            if (pending_.empty()) break;
            auto command = std::move(pending_.front());
            pending_.pop_front();
            lock.unlock();
            run(std::move(command));
            lock.lock();
        }
        current_ = nullptr;
    });
#endif
    started_ = true;
    return true;
}

void RenderThread::run(Command command) {
    command.execute();
    // Release captures before publishing completion, including resource owners.
    command.execute = {};
    {
        std::lock_guard lock(mutex_);
        completed_ = command.serial;
    }
    changed_.notify_all();
}

#ifdef __EMSCRIPTEN__
void* RenderThread::webEntry(void* arg) {
    current_ = static_cast<RenderThread*>(arg);
    // Return to the browser between batches so OffscreenCanvas can present and
    // readback/context events can run, even when the game submits no more work.
    emscripten_exit_with_live_runtime();
    return nullptr;
}

void RenderThread::drainWeb(void* arg) {
    auto& self = *static_cast<RenderThread*>(arg);
    std::deque<Command> batch;
    {
        std::lock_guard lock(self.mutex_);
        batch.swap(self.pending_);
    }
    for (auto& command : batch) self.run(std::move(command));
}
#endif

RenderThread::Fence RenderThread::enqueue(std::function<void()> work) {
    if (!started_) { work(); return 0; }
    assert(!isOwner());
    Fence serial;
    {
        std::lock_guard lock(mutex_);
        serial = ++submitted_;
#ifdef __EMSCRIPTEN__
        const bool wake = pending_.empty();
#endif
        pending_.push_back({serial, std::move(work)});
#ifdef __EMSCRIPTEN__
        if (wake && !emscripten_proxy_async(proxy_, worker_, drainWeb, this)) std::abort();
#endif
    }
    changed_.notify_all();
    return serial;
}

RenderThread::Fence RenderThread::fence() {
    std::lock_guard lock(mutex_);
    return submitted_;
}

bool RenderThread::complete(Fence value) const {
    std::lock_guard lock(mutex_);
    return completed_ >= value;
}

void RenderThread::wait(Fence value) {
    if (!value) return;
    assert(!isOwner());
    std::unique_lock lock(mutex_);
    changed_.wait(lock, [&] { return completed_ >= value; });
}

void RenderThread::invokeChecked(std::function<void()> work) {
#ifdef __cpp_exceptions
    std::exception_ptr error;
    wait(enqueue([&] {
        try { work(); }
        catch (...) { error = std::current_exception(); }
    }));
    if (error) std::rethrow_exception(error);
#else
    wait(enqueue(std::move(work)));
#endif
}

void RenderThread::flush() { if (started_ && !isOwner()) wait(fence()); }

void RenderThread::finishFrame(std::function<void()> end) {
    wait(frames_[frameSlot_]);
    frames_[frameSlot_] = enqueue(std::move(end));
    frameSlot_ ^= 1;
}

void RenderThread::stop() {
    if (!started_) return;
    flush();
#ifdef __EMSCRIPTEN__
    if (!emscripten_proxy_async(proxy_, worker_, [](void*) { pthread_exit(nullptr); }, nullptr)) std::abort();
    pthread_join(worker_, nullptr);
    em_proxying_queue_destroy(proxy_);
    proxy_ = nullptr;
#else
    {
        std::lock_guard lock(mutex_);
        stopping_ = true;
    }
    changed_.notify_all();
    worker_.join();
#endif
    started_ = false;
}

} // namespace esengine
#endif
