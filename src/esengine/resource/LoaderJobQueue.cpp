/**
 * @file    LoaderJobQueue.cpp
 * @brief   Async resource loading job queue implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "LoaderJobQueue.hpp"
#include "../core/Log.hpp"

namespace esengine::resource {

// =============================================================================
// Lifecycle
// =============================================================================

LoaderJobQueue::~LoaderJobQueue() {
    if (initialized_) {
        shutdown();
    }
}

void LoaderJobQueue::init(u32 numWorkers) {
    if (initialized_) {
        ES_LOG_WARN("LoaderJobQueue already initialized");
        return;
    }

    if (numWorkers == 0) {
        numWorkers = std::max(1u, std::thread::hardware_concurrency() - 1);
    }

    shutdownRequested_ = false;

    for (u32 i = 0; i < numWorkers; ++i) {
        workers_.emplace_back(&LoaderJobQueue::workerThread, this);
    }

    initialized_ = true;
    ES_LOG_INFO("LoaderJobQueue initialized with {} worker threads", numWorkers);
}

void LoaderJobQueue::shutdown() {
    if (!initialized_) {
        return;
    }

    ES_LOG_INFO("LoaderJobQueue shutting down...");

    {
        std::lock_guard<std::mutex> lock(pendingMutex_);
        shutdownRequested_ = true;
    }
    pendingCondition_.notify_all();

    for (auto& worker : workers_) {
        if (worker.joinable()) {
            worker.join();
        }
    }
    workers_.clear();

    {
        std::lock_guard<std::mutex> lock(pendingMutex_);
        while (!pendingJobs_.empty()) {
            pendingJobs_.pop();
        }
    }

    {
        std::lock_guard<std::mutex> lock(completionMutex_);
        while (!completions_.empty()) {
            completions_.pop();
        }
    }

    {
        std::lock_guard<std::mutex> lock(activeJobsMutex_);
        activeJobIds_.clear();
    }

    initialized_ = false;
    ES_LOG_INFO("LoaderJobQueue shutdown complete");
}

// =============================================================================
// Job Management
// =============================================================================

u64 LoaderJobQueue::submit(LoadJob job) {
    if (!initialized_) {
        ES_LOG_ERROR("LoaderJobQueue::submit called before init()");
        return 0;
    }

    u64 jobId = nextJobId_++;
    job.jobId = jobId;

    {
        std::lock_guard<std::mutex> lock(activeJobsMutex_);
        activeJobIds_.insert(jobId);
    }

    {
        std::lock_guard<std::mutex> lock(pendingMutex_);
        pendingJobs_.push(std::move(job));
    }
    pendingCondition_.notify_one();

    ES_LOG_DEBUG("LoaderJobQueue: Submitted job {} for '{}'", jobId, job.path);
    return jobId;
}

bool LoaderJobQueue::cancel(u64 jobId) {
    std::lock_guard<std::mutex> lock(activeJobsMutex_);
    auto it = activeJobIds_.find(jobId);
    if (it != activeJobIds_.end()) {
        activeJobIds_.erase(it);
        return true;
    }
    return false;
}

u32 LoaderJobQueue::processCompletions(u32 maxJobs) {
    u32 processed = 0;

    while (maxJobs == 0 || processed < maxJobs) {
        std::function<void()> completeFn;

        {
            std::lock_guard<std::mutex> lock(completionMutex_);
            if (completions_.empty()) {
                break;
            }
            completeFn = std::move(completions_.front());
            completions_.pop();
        }

        if (completeFn) {
            completeFn();
        }
        ++processed;
    }

    return processed;
}

u32 LoaderJobQueue::getPendingCount() const {
    std::lock_guard<std::mutex> lock(pendingMutex_);
    return static_cast<u32>(pendingJobs_.size());
}

u32 LoaderJobQueue::getCompletionCount() const {
    std::lock_guard<std::mutex> lock(completionMutex_);
    return static_cast<u32>(completions_.size());
}

bool LoaderJobQueue::isJobActive(u64 jobId) const {
    std::lock_guard<std::mutex> lock(activeJobsMutex_);
    return activeJobIds_.find(jobId) != activeJobIds_.end();
}

// =============================================================================
// Worker Thread
// =============================================================================

void LoaderJobQueue::workerThread() {
    while (true) {
        LoadJob job;

        {
            std::unique_lock<std::mutex> lock(pendingMutex_);
            pendingCondition_.wait(lock, [this] {
                return shutdownRequested_ || !pendingJobs_.empty();
            });

            if (shutdownRequested_ && pendingJobs_.empty()) {
                break;
            }

            if (pendingJobs_.empty()) {
                continue;
            }

            job = std::move(const_cast<LoadJob&>(pendingJobs_.top()));
            pendingJobs_.pop();
        }

        bool cancelled = false;
        {
            std::lock_guard<std::mutex> lock(activeJobsMutex_);
            if (activeJobIds_.find(job.jobId) == activeJobIds_.end()) {
                cancelled = true;
            }
        }

        if (cancelled) {
            continue;
        }

        ++activeJobs_;

        if (job.workFn) {
            try {
                job.workFn();
            } catch (const std::exception& e) {
                ES_LOG_ERROR("LoaderJobQueue: Job {} threw exception: {}", job.jobId, e.what());
            }
        }

        {
            std::lock_guard<std::mutex> lock(activeJobsMutex_);
            activeJobIds_.erase(job.jobId);
        }

        if (job.completeFn) {
            std::lock_guard<std::mutex> lock(completionMutex_);
            completions_.push(std::move(job.completeFn));
        }

        --activeJobs_;
    }
}

}  // namespace esengine::resource
