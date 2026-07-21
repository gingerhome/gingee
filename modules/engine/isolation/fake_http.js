/**
 * @module engine/isolation/fake_http
 * @description Minimal req/res shims for running gingee() scripts in a worker.
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
 * Server response shim that records status/headers/body for IPC return.
 */
class FakeServerResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headersSent = false;
    this._headers = {};
    this._chunks = [];
    this.writableEnded = false;
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
  }

  write(chunk, encoding, cb) {
    if (chunk != null && chunk !== '') {
      this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding));
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
    this.emit('finish');
    this.emit('close');
    if (typeof cb === 'function') cb();
    return this;
  }

  /**
   * @returns {{ statusCode: number, headers: object, body: Buffer }}
   */
  toResult() {
    return {
      statusCode: this.statusCode || 200,
      headers: this.getHeaders(),
      body: this._chunks.length ? Buffer.concat(this._chunks) : Buffer.alloc(0)
    };
  }
}

module.exports = {
  FakeIncomingMessage,
  FakeServerResponse
};
