module.exports = async function() {
    await gingee(async ($g) => {
        const platform = require('platform');
        try {
            const appName = $g.request.query.app;
            if (!appName) {
                return $g.response.send({ error: 'An `app` query parameter is required.' }, 400);
            }
            const analysis = await platform.analyzeAppBackup(appName);
            $g.response.send({ status: 'success', ...analysis });
        } catch (err) {
            $g.log.error(`Failed to analyze backup for app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({ error: 'An internal error occurred while analyzing the backup.' }, 500);
        }
    });
};
