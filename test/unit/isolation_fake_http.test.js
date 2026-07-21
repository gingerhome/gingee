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
});
