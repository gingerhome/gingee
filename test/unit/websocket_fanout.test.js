const {
  normalizeFanout,
  encodePayload,
  decodePayload,
  RedisFanout,
} = require("../../modules/engine/websocket_fanout");

describe("websocket_fanout", () => {
  describe("normalizeFanout", () => {
    test("defaults to driver none", () => {
      const c = normalizeFanout({});
      expect(c.driver).toBe("none");
      expect(c.redis.key_prefix).toBe("gingee:ws:");
      expect(c.nodeId).toBeTruthy();
    });

    test("reads fanout.driver + sibling redis", () => {
      const c = normalizeFanout({
        enabled: true,
        fanout: { driver: "redis", node_id: "n1" },
        redis: { url: "redis://127.0.0.1:6379", key_prefix: "g:ws:" },
      });
      expect(c.driver).toBe("redis");
      expect(c.nodeId).toBe("n1");
      expect(c.redis.url).toBe("redis://127.0.0.1:6379");
      expect(c.redis.key_prefix).toBe("g:ws:");
    });
  });

  describe("encode/decode", () => {
    test("json objects round-trip", () => {
      const e = encodePayload({ type: "ping", n: 1 });
      expect(e.encoding).toBe("json");
      expect(decodePayload(e.encoding, e.body)).toEqual({ type: "ping", n: 1 });
    });

    test("strings and buffers", () => {
      const s = encodePayload("hello");
      expect(s.encoding).toBe("string");
      expect(decodePayload(s.encoding, s.body)).toBe("hello");

      const b = encodePayload(Buffer.from("abc"));
      expect(b.encoding).toBe("base64");
      expect(Buffer.isBuffer(decodePayload(b.encoding, b.body))).toBe(true);
      expect(decodePayload(b.encoding, b.body).toString()).toBe("abc");
    });
  });

  describe("RedisFanout publish/receive (mock pub/sub)", () => {
    test("skips own origin and delivers remote room messages", async () => {
      const delivered = [];
      const fanout = new RedisFanout(
        {
          driver: "redis",
          nodeId: "node-a",
          redis: { key_prefix: "t:" },
        },
        { info: jest.fn(), error: jest.fn() },
        {
          onRoom: (app, room, data) => delivered.push({ app, room, data }),
          onApp: () => {},
        },
      );

      // Simulate inbound Redis message from another node
      fanout._onMessage(
        JSON.stringify({
          v: 1,
          origin: "node-b",
          scope: "room",
          app: "chat",
          room: "lobby",
          encoding: "json",
          body: JSON.stringify({ type: "hi" }),
        }),
      );
      expect(delivered).toEqual([
        { app: "chat", room: "lobby", data: { type: "hi" } },
      ]);

      // Own origin ignored
      delivered.length = 0;
      fanout._onMessage(
        JSON.stringify({
          v: 1,
          origin: "node-a",
          scope: "room",
          app: "chat",
          room: "lobby",
          encoding: "json",
          body: JSON.stringify({ type: "self" }),
        }),
      );
      expect(delivered).toHaveLength(0);
    });

    test("publishRoom uses pub client when started-like", async () => {
      const published = [];
      const fanout = new RedisFanout(
        {
          driver: "redis",
          nodeId: "n1",
          redis: { key_prefix: "p:" },
        },
        { info: jest.fn(), error: jest.fn() },
        {},
      );
      fanout.pub = {
        publish: async (ch, raw) => {
          published.push({ ch, raw: JSON.parse(raw) });
          return 1;
        },
      };
      fanout._closed = false;

      await fanout.publishRoom("app1", "r1", { x: 1 });
      expect(published).toHaveLength(1);
      expect(published[0].ch).toBe("p:broadcast");
      expect(published[0].raw.scope).toBe("room");
      expect(published[0].raw.app).toBe("app1");
      expect(published[0].raw.room).toBe("r1");
      expect(published[0].raw.origin).toBe("n1");
      expect(published[0].raw.encoding).toBe("json");
    });
  });
});
