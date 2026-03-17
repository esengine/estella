/**
 * @file    LoaderJobQueue.hpp
 * @brief   Async resource loading job queue
 * @details Provides a thread pool for background resource loading with
 *          main-thread completion callbacks.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"

#include <string>
#include <functional>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <vector>
#include <unordered_set>

namespace esengine::resource {

// =============================================================================
// Load Priority
// =============================================================================

enum class LoadPriority : u8 {
    Low = 0,
    Normal = 1,
    High = 2,
    Immediate = 3
};

// =============================================================================
// Load Job
// =============================================================================

/**
 * @brief A single loading job for the queue
 */
struct LoadJob {
    u64 jobId = 0;                              ///< Unique job identifier
    std::string path;                           ///< Resource path for logging
    LoadPriority priority = LoadPriority::Normal;
    std::function<void()> workFn;               ///< Function to execute on worker thread
    std::function<void()> completeFn;           ///< Function to execute on main thread

    bool operator<(const LoadJob& other) const {
        return static_cast<u8>(priority) < static_cast<u8>(other.priority);
    }
};

// =============================================================================
// LoaderJobQueue Class
// =============================================================================

/**
 * @brief Thread pool for async resource loading
 *
 * @details Manages a pool of worker threads for background loading.
 *          Completion callbacks are queued and must be processed on the
 *          main thread via processCompletions().
 *
 * @code
 * LoaderJobQueue queue;
 * queue.init(4);  // 4 worker threads
 *
 * // Submit a job
 * queue.submit({
 *     .jobId = 1,
 *     .path = "texture.png",
 *     .priority = LoadPriority::Normal,
 *     .workFn = [&]() { loadedData = loadFromDisk(); },
 *     .completeFn = [&]() { createGPUResource(loadedData); }
 * });
 *
 * // In main loop
 * queue.processCompletions();
 *
 * queue.shutdown();
 * @endcode
 */
class LoaderJobQueue {
public:
    LoaderJobQueue() = default;
    ~LoaderJobQueue();

    LoaderJobQueue(const LoaderJobQueue&) = delete;
    LoaderJobQueue& operator=(const LoaderJobQueue&) = delete;

    /**
     * @brief Initializes the job queue with worker threads
     * @param numWorkers Number of worker threads (0 = hardware concurrency)
     */
    void init(u32 numWorkers = 0);

    /**
     * @brief Shuts down all worker threads
     * @details Waits for all pending jobs to complete
     */
    void shutdown();

    /**
     * @brief Checks if the queue is initialized
     * @return True if init() has been called
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Submits a job for async loading
     * @param job The job to submit
     * @return Job ID for tracking
     */
    u64 submit(LoadJob job);

    /**
     * @brief Cancels a pending job
     * @param jobId Job to cancel
     * @return True if job was cancelled (false if already running/completed)
     */
    bool cancel(u64 jobId);

    /**
     * @brief Processes completed job callbacks on the main thread
     * @param maxJobs Maximum jobs to process (0 = unlimited)
     * @return Number of completions processed
     */
    u32 processCompletions(u32 maxJobs = 0);

    /**
     * @brief Gets the number of pending jobs
     * @return Number of jobs waiting to be processed
     */
    u32 getPendingCount() const;

    /**
     * @brief Gets the number of completed jobs waiting for callbacks
     * @return Number of completions waiting
     */
    u32 getCompletionCount() const;

    /**
     * @brief Checks if a job is still pending or running
     * @param jobId Job to check
     * @return True if job is still in queue or running
     */
    bool isJobActive(u64 jobId) const;

private:
    void workerThread();

    std::vector<std::thread> workers_;
    std::priority_queue<LoadJob> pendingJobs_;
    std::queue<std::function<void()>> completions_;

    mutable std::mutex pendingMutex_;
    mutable std::mutex completionMutex_;
    std::condition_variable pendingCondition_;

    std::atomic<u64> nextJobId_{1};
    std::atomic<bool> shutdownRequested_{false};
    std::atomic<u32> activeJobs_{0};
    bool initialized_ = false;

    std::unordered_set<u64> activeJobIds_;
    mutable std::mutex activeJobsMutex_;
};

}  // namespace esengine::resource
