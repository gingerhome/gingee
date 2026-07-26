module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require('platform');
      const q = $g.request.query || {};
      const scope = q.scope || 'server';
      const appName = q.app || q.appName || null;
      const result = platform.listLogFiles({
        scope,
        appName: appName || undefined
      });
      $g.response.send({ status: 'success', ...result });
    } catch (e) {
      $g.response.send({ status: 'error', error: e.message }, 400);
    }
  });
};
