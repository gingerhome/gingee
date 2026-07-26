module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require('platform');
      const body = $g.request.body || {};
      const jobId = body.jobId || ($g.request.query && $g.request.query.jobId);
      if (!jobId) {
        $g.response.send({ status: 'error', error: 'jobId is required' }, 400);
        return;
      }
      const result = await platform.retryQueueDlqJob(jobId);
      $g.response.send({ status: 'success', result });
    } catch (e) {
      $g.response.send({ status: 'error', error: e.message }, 500);
    }
  });
};
