/**
 * @module engine/isolation/fake_http
 * @description Minimal req/res shims for running gingee() scripts in a worker.
 * Supports buffered capture and optional streaming callbacks for IPC.
 * Engine-internal.
 */

const { EventEmitter } = require('events');

/**
 * Incoming message shim. Buffers a body and emits data/end when listeners attach
 * so modules/gingee body parsing still works.
 */
class FakeIncomingMessage extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.method
   * @param {string} opts.url
   * @param {object} opts.headers
   * @param {Buffer} [opts.body]
   */
  constructor(opts) {
    super();
    this.method = opts.method || 'GET';
    this.url = opts.url || '/';
    this.headers = { ...(opts.headers || {}) };
    this.connection = { encrypted: false };
    this.socket = this.connection;
    this._body = Buffer.isBuffer(opts.body) ? opts.body : Buffer.alloc(0);
    this._bodyEmitted = false;
    this.bodyResolved = false;
    this.body = undefined;

    if (this._body.length > 0 && this.headers['content-length'] == null) {
      this.headers['content-length'] = String(this._body.length);
    }
  }

  on(event, listener) {
    const result = super.on(event, listener);
    if ((event === 'data' || event === 'end' || event === 'readable') && !this._bodyEmitted) {
      process.nextTick(() => this._emitBufferedBody());
    }
    return result;
  }

  once(event, listener) {
    const result = super.once(event, listener);
    if ((event === 'data' || event === 'end') && !this._bodyEmitted) {
      process.nextTick(() => this._emitBufferedBody());
    }
    return result;
  }

  _emitBufferedBody() {
    if (this._bodyEmitted) return;
    this._bodyEmitted = true;
    if (this._body.length > 0) {
      this.emit('data', this._body);
    }
    this.emit('end');
  }
}

/**
 * Server response shim that records status/headers/body for IPC return,
 * and optionally streams via hooks (for SSE over IPC).
 *
 * @param {object} [streamHooks]
 * @param {function} [streamHooks.onStreamStart] - (statusCode, headers) => void
 * @param {function} [streamHooks.onStreamChunk] - (Buffer) => void
 * @param {function} [streamHooks.onStreamEnd] - () => void
 */
class FakeServerResponse extends EventEmitter {
  constructor(streamHooks) {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this._headers = {};
    this._chunks = [];
    this.writableEnded = false;
    this._streaming = false;
    this._streamHooks = streamHooks || null;
  }

  setHeader(name, value) {
    this._headers[String(name).toLowerCase()] = value;
  }

  getHeader(name) {
    return this._headers[String(name).toLowerCase()];
  }

  getHeaders() {
    return { ...this._headers };
  }

  removeHeader(name) {
    delete this._headers[String(name).toLowerCase()];
  }

  writeHead(statusCode, statusMessageOrHeaders, maybeHeaders) {
    this.statusCode = statusCode || this.statusCode;
    let headers = maybeHeaders;
    if (statusMessageOrHeaders && typeof statusMessageOrHeaders === 'object') {
      headers = statusMessageOrHeaders;
    }
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        this.setHeader(k, v);
      }
    }
    this.headersSent = true;
    return this;
  }

  flushHeaders() {
    this.headersSent = true;
    // gingee startStream calls flushHeaders — treat as stream start if hooks present
    if (this._streamHooks && this._streamHooks.onStreamStart && !this._streaming) {
      this._streaming = true;
      try {
        this._streamHooks.onStreamStart(this.statusCode || 200, this.getHeaders());
      } catch (_) {
        /* ignore */
      }
    }
  }

  write(chunk, encoding, cb) {
    if (chunk != null && chunk !== '') {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
      if (this._streaming && this._streamHooks && this._streamHooks.onStreamChunk) {
        try {
          this._streamHooks.onStreamChunk(buf);
        } catch (_) {
          /* ignore */
        }
      } else {
        this._chunks.push(buf);
      }
    }
    this.headersSent = true;
    if (typeof encoding === 'function') encoding();
    else if (typeof cb === 'function') cb();
    return true;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = null;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    if (chunk != null && chunk !== '') {
      this.write(chunk, encoding);
    }
    this.writableEnded = true;
    this.headersSent = true;
    if (this._streaming && this._streamHooks && this._streamHooks.onStreamEnd) {
      try {
        this._streamHooks.onStreamEnd();
      } catch (_) {
        /* ignore */
      }
    }
    this.emit('finish');
    this.emit('close');
    if (typeof cb === 'function') cb();
    return this;
  }

  /**
   * @returns {{ statusCode: number, headers: object, body: Buffer, streamed: boolean }}
   */
  toResult() {
    return {
      statusCode: this.statusCode || 200,
      headers: this.getHeaders(),
      body: this._chunks.length ? Buffer.concat(this._chunks) : Buffer.alloc(0),
      streamed: this._streaming
    };
  }
}

module.exports = {
  FakeIncomingMessage,
  FakeServerResponse
};
