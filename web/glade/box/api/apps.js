// Handles GET /glade/api/apps
module.exports = async function () {
    gingee(async ($g) => {
        const platform = require('platform');

        try {
            const apps = platform.listApps();
            const allApps = $g.apps || {};
            const appData = apps.map(appName => {
                // We need to get the app object from the context to read its version
                const app = allApps[appName];
                return {
                    name: appName,
                    version: (app && app.config && app.config.version) || 'N/A'
                };
            });

            $g.response.send({ code: 200, status: 'success', apps: appData });

        } catch (err) {
            $g.log.error('Failed to list apps', { error: err.message });
            $g.response.send({ code: 500, error: 'Failed to list applications.' });
        }
    });
};
