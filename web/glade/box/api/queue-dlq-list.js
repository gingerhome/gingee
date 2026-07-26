module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const q = $g.request.query || {};
      const body = $g.request.body || {};
      const appName = q.appName || body.appName || null;
      const limit = q.limit || body.limit || 100;
      const jobs = await platform.listQueueDlq({
        appName: appName || undefined,
        limit: Number(limit) || 100,
      });
      $g.response.send({ status: "success", jobs });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 500);
    }
  });
};
