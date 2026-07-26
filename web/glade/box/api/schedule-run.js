module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require('platform');
      const body = $g.request.body || {};
      const appName = body.appName || ($g.request.query && $g.request.query.appName);
      const jobName =
        body.jobName || body.name || ($g.request.query && $g.request.query.jobName);
      if (!appName || !jobName) {
        $g.response.send(
          { status: 'error', error: 'appName and jobName are required' },
          400
        );
        return;
      }
      const result = await platform.runSchedulerJob(appName, jobName);
      $g.response.send({ status: 'success', result });
    } catch (e) {
      $g.response.send({ status: 'error', error: e.message }, 500);
    }
  });
};
