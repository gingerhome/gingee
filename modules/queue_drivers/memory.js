/**
 * In-process memory queue driver (dev / single-node).
 * Includes an in-memory DLQ (lost on process restart).
 * @private
 */

const { randomUUID } = require('crypto');

/**
 * @param {object} opts
 * @param {function} opts.onReady - (job) => void when a job is ready to process
 * @param {object} opts.logger
 * @param {number} [opts.dlqMax] - max dead-letter entries retained
 */
function createMemoryDriver(opts) {
  const onReady = opts.onReady;
  const log = opts.logger || console;
  const dlqMax = opts.dlqMax != null ? Number(opts.dlqMax) : 500;
  /** @type {Map<string, object>} */
  const jobs = new Map();
  /** id → dead letter record */
  /** @type {Map<string, object>} */
  const dlq = new Map();
  /** newest first */
  /** @type {string[]} */
  const dlqOrder = [];
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

  function sanitize(job) {
    if (!job) return null;
    const { _timer, ...rest } = job;
    return { ...rest };
  }

  function trimDlq() {
    while (dlqOrder.length > dlqMax) {
      const oldId = dlqOrder.pop();
      dlq.delete(oldId);
    }
  }

  return {
    name: 'memory',

    async start() {
      /* no-op */
    },

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
        createdAt: jobInput.createdAt || Date.now(),
        error: null,
        failedAt: null
      };
      // Remove from DLQ if re-queued with same id
      if (dlq.has(id)) {
        dlq.delete(id);
        const idx = dlqOrder.indexOf(id);
        if (idx >= 0) dlqOrder.splice(idx, 1);
      }
      jobs.set(id, job);
      schedule(job);
      return { id, name: job.name, appName: job.appName };
    },

    async retry(job) {
      const next = {
        ...job,
        attempt: (job.attempt || 1) + 1,
        status: 'delayed',
        runAt: Date.now() + (job.backoffMs || 1000) * Math.pow(2, Math.max(0, (job.attempt || 1) - 1)),
        _timer: null,
        error: null,
        failedAt: null
      };
      jobs.set(next.id, next);
      schedule(next);
      return next;
    },

    async complete(jobId) {
      const j = jobs.get(jobId);
      if (j) {
        if (j._timer) clearTimeout(j._timer);
        jobs.delete(jobId);
      }
    },

    /**
     * Permanent failure → DLQ.
     * @param {object} job
     * @param {Error|string} [err]
     */
    async deadLetter(job, err) {
      if (!job || !job.id) return;
      const existing = jobs.get(job.id);
      if (existing && existing._timer) clearTimeout(existing._timer);
      jobs.delete(job.id);

      const record = sanitize({
        ...job,
        status: 'failed',
        error: err ? err.message || String(err) : job.error || 'failed',
        failedAt: Date.now()
      });
      dlq.set(record.id, record);
      const prev = dlqOrder.indexOf(record.id);
      if (prev >= 0) dlqOrder.splice(prev, 1);
      dlqOrder.unshift(record.id);
      trimDlq();
    },

    /** @deprecated use deadLetter */
    async fail(jobId) {
      const j = jobs.get(jobId);
      if (j) await this.deadLetter(j, j.error || 'failed');
    },

    async listDlq(opts = {}) {
      const limit = opts.limit != null ? Math.min(500, Math.max(1, Number(opts.limit))) : 100;
      const appFilter = opts.appName || null;
      const out = [];
      for (const id of dlqOrder) {
        const rec = dlq.get(id);
        if (!rec) continue;
        if (appFilter && rec.appName !== appFilter) continue;
        out.push(sanitize(rec));
        if (out.length >= limit) break;
      }
      return out;
    },

    async getDlqJob(jobId) {
      return sanitize(dlq.get(jobId) || null);
    },

    async discardDlq(jobId) {
      if (!dlq.has(jobId)) return false;
      dlq.delete(jobId);
      const idx = dlqOrder.indexOf(jobId);
      if (idx >= 0) dlqOrder.splice(idx, 1);
      return true;
    },

    /**
     * Remove from DLQ and re-enqueue with attempt 1.
     * @param {string} jobId
     * @returns {Promise<object|null>} enqueue result
     */
    async retryDlq(jobId, opts = {}) {
      const rec = dlq.get(jobId);
      if (!rec) return null;
      await this.discardDlq(jobId);
      // Admin retry: fresh attempt budget (not stuck at the exhausted maxAttempts: 1)
      const maxAttempts =
        opts.maxAttempts != null
          ? Number(opts.maxAttempts)
          : Math.max(3, Number(rec.maxAttempts) || 3);
      return this.enqueue({
        id: rec.id,
        appName: rec.appName,
        name: rec.name,
        script: rec.script,
        payload: rec.payload,
        attempt: 1,
        maxAttempts,
        backoffMs: rec.backoffMs,
        delayMs: 0,
        createdAt: rec.createdAt
      });
    },

    async dlqSize(appName) {
      if (!appName) return dlq.size;
      let n = 0;
      for (const rec of dlq.values()) {
        if (rec.appName === appName) n++;
      }
      return n;
    },

    async shutdown() {
      closed = true;
      for (const j of jobs.values()) {
        if (j._timer) clearTimeout(j._timer);
      }
      jobs.clear();
      dlq.clear();
      dlqOrder.length = 0;
    },

    size() {
      return jobs.size;
    }
  };
}

module.exports = { createMemoryDriver };
