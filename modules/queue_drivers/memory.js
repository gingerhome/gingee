/**
 * In-process memory queue driver (dev / single-node).
 * Not durable across restarts.
 * @private
 */

const { randomUUID } = require('crypto');

/**
 * @param {object} opts
 * @param {function} opts.onReady - (job) => void when a job is ready to process
 * @param {object} opts.logger
 */
function createMemoryDriver(opts) {
  const onReady = opts.onReady;
  const log = opts.logger || console;
  /** @type {Map<string, object>} */
  const jobs = new Map();
  let closed = false;

  function schedule(job) {
    if (closed) return;
    const delay = Math.max(0, (job.runAt || 0) - Date.now());
    const timer = setTimeout(() => {
      if (closed) return;
      job.status = 'waiting';
      try {
        onReady(job);
      } catch (e) {
        log.error(`[queue:memory] onReady error: ${e.message}`);
      }
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    job._timer = timer;
  }

  return {
    name: 'memory',

    async start() {
      /* no-op */
    },

    /**
     * @param {object} jobInput
     * @returns {Promise<object>}
     */
    async enqueue(jobInput) {
      const id = jobInput.id || randomUUID();
      const job = {
        id,
        appName: jobInput.appName,
        name: jobInput.name,
        script: jobInput.script,
        payload: jobInput.payload,
        attempt: jobInput.attempt || 1,
        maxAttempts: jobInput.maxAttempts || 3,
        backoffMs: jobInput.backoffMs != null ? jobInput.backoffMs : 1000,
        runAt: Date.now() + (jobInput.delayMs || 0),
        status: 'delayed',
        createdAt: Date.now()
      };
      jobs.set(id, job);
      schedule(job);
      return { id, name: job.name, appName: job.appName };
    },

    /**
     * Re-queue after failure with backoff.
     * @param {object} job
     */
    async retry(job) {
      const next = {
        ...job,
        attempt: (job.attempt || 1) + 1,
        status: 'delayed',
        runAt: Date.now() + (job.backoffMs || 1000) * Math.pow(2, Math.max(0, (job.attempt || 1) - 1)),
        _timer: null
      };
      jobs.set(next.id, next);
      schedule(next);
      return next;
    },

    async complete(jobId) {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'completed';
        jobs.delete(jobId);
      }
    },

    async fail(jobId) {
      const j = jobs.get(jobId);
      if (j) {
        j.status = 'failed';
        jobs.delete(jobId);
      }
    },

    async shutdown() {
      closed = true;
      for (const j of jobs.values()) {
        if (j._timer) clearTimeout(j._timer);
      }
      jobs.clear();
    },

    /** @returns {number} */
    size() {
      return jobs.size;
    }
  };
}

module.exports = { createMemoryDriver };
