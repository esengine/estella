// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "PhysicsTaskPool.hpp"

#ifndef __EMSCRIPTEN__

#include <algorithm>

namespace esengine::physics {
namespace {

/// Leave headroom for the threads the frame already owns (the game/render thread
/// this is called from, and the OS). Solving is not the only thing running.
constexpr int kReservedCores = 2;
/// Past a handful of workers the sync bits cost more than the split saves, and a
/// phone's remaining cores are the small ones.
constexpr int kMaxWorkers = 4;

}  // namespace

TaskPool::TaskPool() {
    const int cores = static_cast<int>(std::thread::hardware_concurrency());
    workerCount_ = std::clamp(cores - kReservedCores, 0, kMaxWorkers);
    if (workerCount_ < 2) {
        // One worker is the serial solver with extra bookkeeping; take the
        // serial path instead and report no workers.
        workerCount_ = 0;
        return;
    }

    // Worker 0 is whoever steps the world — it helps from finishTask — so the
    // pool owns the rest. One thread per index, and only one: Box2D indexes its
    // per-worker scratch by these, and two threads on one index corrupt a step.
    threads_.reserve(static_cast<size_t>(workerCount_ - 1));
    for (int i = 1; i < workerCount_; i++) {
        threads_.emplace_back([this, i] { workerLoop(static_cast<uint32_t>(i)); });
    }
}

TaskPool::~TaskPool() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    queued_.notify_all();
    for (auto& thread : threads_) {
        if (thread.joinable()) thread.join();
    }
}

void TaskPool::configure(b2WorldDef& def) {
    if (workerCount_ == 0) return;   // serial world; leave Box2D's defaults
    def.workerCount = workerCount_;
    def.enqueueTask = &TaskPool::enqueueTask;
    def.finishTask = &TaskPool::finishTask;
    def.userTaskContext = this;
}

TaskPool::Group* TaskPool::acquireGroup() {
    for (auto& group : groups_) {
        if (group.free) {
            group.free = false;
            group.pending.store(0, std::memory_order_relaxed);
            return &group;
        }
    }
    // deque keeps existing elements addressable, which matters because a Group
    // is held by pointer while its jobs run.
    groups_.emplace_back();
    groups_.back().free = false;
    return &groups_.back();
}

void* TaskPool::submit(b2TaskCallback* task, int itemCount, int minRange, void* taskContext) {
    if (itemCount <= 0) return nullptr;

    // Honour minRange: below it the split costs more than it saves, and Box2D
    // states the range each worker gets should not be smaller.
    const int maxSlices = std::max(1, itemCount / std::max(1, minRange));
    const int slices = std::clamp(maxSlices, 1, workerCount_);

    Group* group = nullptr;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        group = acquireGroup();
        group->pending.store(slices, std::memory_order_relaxed);

        const int base = itemCount / slices;
        const int remainder = itemCount % slices;
        int start = 0;
        for (int i = 0; i < slices; i++) {
            const int size = base + (i < remainder ? 1 : 0);
            queue_.push_back(Job{task, start, start + size, taskContext, group});
            start += size;
        }
    }
    if (slices == 1) queued_.notify_one();
    else queued_.notify_all();
    return group;
}

void TaskPool::wait(Group* group) {
    // The calling thread is worker 0, so it works rather than blocks. Box2D
    // enqueues the island split alongside the whole worker set; a thread that
    // only waited could leave a solver worker queued behind it, and its peers
    // spin on a barrier that worker never reaches.
    while (group->pending.load(std::memory_order_acquire) != 0) {
        Job job;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (!queue_.empty()) {
                job = queue_.front();
                queue_.pop_front();
            }
        }
        if (!job.fn) {
            // Nothing queued: the remaining slices are already running on pool
            // threads, so give up the core rather than spinning on them.
            std::this_thread::yield();
            continue;
        }
        job.fn(job.startIndex, job.endIndex, 0u, job.taskContext);
        job.group->pending.fetch_sub(1, std::memory_order_acq_rel);
    }
    std::lock_guard<std::mutex> lock(mutex_);
    group->free = true;
}

void TaskPool::workerLoop(uint32_t workerIndex) {
    while (true) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            queued_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
            if (stopping_ && queue_.empty()) return;
            job = queue_.front();
            queue_.pop_front();
        }
        // This thread owns this index for the pool's lifetime, which is the
        // guarantee Box2D asks for.
        job.fn(job.startIndex, job.endIndex, workerIndex, job.taskContext);
        job.group->pending.fetch_sub(1, std::memory_order_acq_rel);
    }
}

void* TaskPool::enqueueTask(b2TaskCallback* task, int itemCount, int minRange,
                            void* taskContext, void* userContext) {
    return static_cast<TaskPool*>(userContext)->submit(task, itemCount, minRange, taskContext);
}

void TaskPool::finishTask(void* userTask, void* userContext) {
    if (!userTask) return;
    static_cast<TaskPool*>(userContext)->wait(static_cast<Group*>(userTask));
}

}  // namespace esengine::physics

#endif  // __EMSCRIPTEN__
