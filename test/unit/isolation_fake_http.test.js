const {
  FakeIncomingMessage,
  FakeServerResponse
} = require('../../modules/engine/isolation/fake_http');

describe('isolation fake_http', () => {
  test('FakeServerResponse captures status headers body', () => {
    const res = new FakeServerResponse();
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 201;
    res.end(JSON.stringify({ ok: true }));
    const result = res.toResult();
    expect(result.statusCode).toBe(201);
    expect(result.headers['content-type']).toBe('application/json');
    expect(JSON.parse(result.body.toString())).toEqual({ ok: true });
    expect(res.writableEnded).toBe(true);
  });

  test('FakeIncomingMessage emits buffered body', (done) => {
    const body = Buffer.from('{"a":1}');
    const req = new FakeIncomingMessage({
      method: 'POST',
      url: '/x',
      headers: { 'content-type': 'application/json' },
      body
    });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      expect(Buffer.concat(chunks).toString()).toBe('{"a":1}');
      done();
    });
  });

  test('stream hooks fire on flushHeaders/write/end', () => {
    const started = [];
    const chunks = [];
    let ended = false;
    const res = new FakeServerResponse({
      onStreamStart: (status, headers) => started.push({ status, headers }),
      onStreamChunk: (buf) => chunks.push(buf),
      onStreamEnd: () => {
        ended = true;
      }
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    res.write('data: a\n\n');
    res.write(Buffer.from('data: b\n\n'));
    res.end();

    expect(started).toHaveLength(1);
    expect(started[0].status).toBe(200);
    expect(started[0].headers['content-type']).toBe('text/event-stream');
    expect(Buffer.concat(chunks).toString()).toBe('data: a\n\ndata: b\n\n');
    expect(ended).toBe(true);
    expect(res.toResult().streamed).toBe(true);
    // Streamed path does not buffer into toResult body
    expect(res.toResult().body.length).toBe(0);
  });
});
