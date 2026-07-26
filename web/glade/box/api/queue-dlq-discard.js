module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const body = $g.request.body || {};
      const jobId = body.jobId || ($g.request.query && $g.request.query.jobId);
      if (!jobId) {
        $g.response.send({ status: "error", error: "jobId is required" }, 400);
        return;
      }
      const ok = await platform.discardQueueDlqJob(jobId);
      if (!ok) {
        $g.response.send(
          { status: "error", error: "Job not found in DLQ" },
          404,
        );
        return;
      }
      $g.response.send({ status: "success", discarded: true, jobId });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 500);
    }
  });
};
