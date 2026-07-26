module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const q = $g.request.query || {};
      const limit = q.limit != null ? Number(q.limit) : 200;
      const appName = q.app || q.appName || null;
      const jobs = await platform.listQueueLiveJobs({
        appName: appName || undefined,
        limit: Number.isFinite(limit) ? limit : 200,
      });
      $g.response.send({ status: "success", jobs });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 500);
    }
  });
};
