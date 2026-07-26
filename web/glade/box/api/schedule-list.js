module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const q = $g.request.query || {};
      const appName = q.app || q.appName || null;
      const status = platform.getSchedulerStatus();
      const jobs = platform.listSchedulerJobs({
        appName: appName || undefined,
        filterPartial: true,
      });
      $g.response.send({ status: "success", statusInfo: status, jobs });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 500);
    }
  });
};
