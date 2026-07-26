module.exports = async function () {
  await gingee(async ($g) => {
    try {
      const platform = require("platform");
      const stats = await platform.getQueueStats();
      $g.response.send({ status: "success", stats });
    } catch (e) {
      $g.response.send({ status: "error", error: e.message }, 500);
    }
  });
};
