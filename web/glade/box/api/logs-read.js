module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const q = $g.request.query || {};
      const body = $g.request.body || {};
      const scope = body.scope || q.scope || "server";
      const appName = body.appName || body.app || q.appName || q.app || null;
      const file = body.file || q.file || null;
      const lines = body.lines != null ? body.lines : q.lines;
      const level = body.level || q.level || "all";
      const engineOnly =
        body.engineOnly != null
          ? body.engineOnly
          : q.engineOnly != null
            ? q.engineOnly
            : false;
      // Default hideLogQueries on unless explicitly false/0
      let hideLogQueries = true;
      const hlq =
        body.hideLogQueries != null
          ? body.hideLogQueries
          : q.hideLogQueries != null
            ? q.hideLogQueries
            : null;
      if (hlq === false || hlq === "false" || hlq === "0" || hlq === 0) {
        hideLogQueries = false;
      }
      const search = body.q || body.search || q.q || q.search || "";

      const result = platform.readLogFile({
        scope,
        appName: appName || undefined,
        file: file || undefined,
        lines,
        level,
        engineOnly,
        hideLogQueries,
        q: search,
      });
      $g.response.send({ status: "success", ...result });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 400);
    }
  });
};
