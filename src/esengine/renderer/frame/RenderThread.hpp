// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <cstdint>
#include <functional>

#ifdef ES_RENDER_THREADS
#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>
#include <thread>
#include <type_traits>
#ifdef __EMSCRIPTEN__
#include <emscripten/proxying.h>
#endif
#endif

namespace esengine {

// Single game-side producer. A fence completes after the command returns on the
// render CPU, independently of when the graphics driver finishes the GPU work.
class RenderThread {
public:
    using Fence = std::uint64_t;
#ifdef ES_RENDER_THREADS
    RenderThread() = default;
    RenderThread(const RenderThread&) = delete;
    RenderThread& operator=(const RenderThread&) = delete;
    ~RenderThread();
    bool start(const char* canvas = nullptr);
    void stop();
    bool enabled() const { return started_; }
    bool isOwner() const { return current_ == this; }
    Fence enqueue(std::function<void()> work);
    Fence fence();
    bool complete(Fence value) const;
    void wait(Fence value);
    void finishFrame(std::function<void()> end);
    void flush();

    // Borrowed arguments and return storage stay with the blocked caller.
    template<class F> auto invoke(F&& fn) -> std::invoke_result_t<F> {
        using Result = std::invoke_result_t<F>;
        if (!enabled() || isOwner()) return fn();
        if constexpr (std::is_void_v<Result>) {
            invokeChecked([&fn] { fn(); });
        } else {
            std::optional<Result> result;
            invokeChecked([&] { result.emplace(fn()); });
            return std::move(*result);
        }
    }

private:
    struct Command { Fence serial; std::function<void()> execute; };
    static thread_local RenderThread* current_;
    mutable std::mutex mutex_;
    std::condition_variable changed_;
    std::deque<Command> pending_;
    Fence submitted_ = 0;
    Fence completed_ = 0;
    Fence frames_[2]{};
    unsigned frameSlot_ = 0;
    bool started_ = false;
    bool stopping_ = false;
    void run(Command command);
    void invokeChecked(std::function<void()> work);
#ifdef __EMSCRIPTEN__
    pthread_t worker_{};
    em_proxying_queue* proxy_ = nullptr;
    static void* webEntry(void* arg);
    static void drainWeb(void* arg);
#else
    std::thread worker_;
#endif
#else
    bool start(const char* = nullptr) { return false; }
    void stop() {}
    bool enabled() const { return false; }
    bool isOwner() const { return false; }
    Fence enqueue(std::function<void()> fn) { fn(); return 0; }
    Fence fence() { return 0; }
    bool complete(Fence value) const { return value == 0; }
    void wait(Fence) {}
    void finishFrame(std::function<void()> fn) { fn(); }
    void flush() {}
    template<class F> decltype(auto) invoke(F&& fn) { return fn(); }
#endif
};

} // namespace esengine
