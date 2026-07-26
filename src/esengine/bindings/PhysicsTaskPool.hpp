// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsTaskPool.hpp
 * @brief   The worker pool Box2D solves across on a device.
 *
 * @details Box2D partitions a step into tasks and asks a host-supplied pool to
 *          run them; given none it solves on the calling thread, which is what
 *          the web build does and must keep doing (a wasm side module has no
 *          threads to hand it). A device has cores sitting idle, so the same
 *          module builds this pool there instead. The simulation is unchanged
 *          either way: Box2D is deterministic under multithreading, and two
 *          threads give the same result as eight.
 *
 *          Two properties of Box2D's solver dictate the shape:
 *
 *          - Enqueue must not run the task. Worker 0 drives the stage sync bits
 *            and every other worker spins on them, so a task executed inline
 *            would spin against a worker that has not started.
 *          - The calling thread IS worker 0, and finishing drains the queue
 *            rather than blocking. Box2D enqueues the island split alongside the
 *            whole worker set, so a pool that only waits can leave a solver
 *            worker queued behind it, never reaching the barrier its peers spin
 *            on. Helping also keeps each worker index on exactly one thread at a
 *            time, which Box2D requires — indices are its per-worker scratch,
 *            and two threads sharing one corrupts the step.
 */
#pragma once

#ifndef __EMSCRIPTEN__

#include <box2d/types.h>

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

namespace esengine::physics {

/**
 * A fixed pool of worker threads Box2D enqueues onto. Not general purpose: it
 * exists to satisfy `b2EnqueueTaskCallback` / `b2FinishTaskCallback`, and its
 * lifetime is the physics world's.
 */
class TaskPool {
public:
    /** Builds a pool sized from the hardware, or an empty one when there is only
     *  a single core to schedule on (in which case Box2D solves inline). */
    TaskPool();
    ~TaskPool();

    TaskPool(const TaskPool&) = delete;
    TaskPool& operator=(const TaskPool&) = delete;

    /** How many workers Box2D should split a step across, counting the calling
     *  thread; 0 when the pool is inactive and the world stays single-threaded. */
    int workerCount() const { return workerCount_; }

    /** Wire this pool into a world definition. A pool with no workers leaves the
     *  definition alone, so the world stays on the calling thread. */
    void configure(b2WorldDef& def);

private:
    /** The handle a caller waits on: the slices of one enqueued task. */
    struct Group {
        std::atomic<int> pending{0};
        /** Groups are pooled and reused; this marks one as available again. */
        bool free = true;
    };

    /** One contiguous slice of a parallel-for, tagged with the group it completes. */
    struct Job {
        b2TaskCallback* fn = nullptr;
        int startIndex = 0;
        int endIndex = 0;
        void* taskContext = nullptr;
        Group* group = nullptr;
    };

    static void* enqueueTask(b2TaskCallback* task, int itemCount, int minRange,
                             void* taskContext, void* userContext);
    static void finishTask(void* userTask, void* userContext);

    void* submit(b2TaskCallback* task, int itemCount, int minRange, void* taskContext);
    void wait(Group* group);
    void workerLoop(uint32_t workerIndex);
    Group* acquireGroup();

    int workerCount_ = 0;
    std::vector<std::thread> threads_;
    std::deque<Job> queue_;
    // Groups are pooled rather than allocated per task: a step enqueues on the
    // order of a dozen, every frame, forever.
    std::deque<Group> groups_;
    std::mutex mutex_;
    std::condition_variable queued_;
    bool stopping_ = false;
};

}  // namespace esengine::physics

#endif  // __EMSCRIPTEN__
