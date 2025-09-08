module.exports = async function() {
    ginger(async ($g) => {
        const platform = require('platform');

        try {
            // Get the appName from the query parameters.
            const appName = $g.request.query.app;
            const appVersion = $g.apps[appName] && $g.apps[appName].config && $g.apps[appName].config.version || 'latest';

            if (!appName) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'An `app` query parameter is required.'
                }, 400);
            }

            // Call the platform module to generate the package buffer.
            const packageBuffer = await platform.packageApp(appName);

            if (packageBuffer) {
                $g.log.info(`Packaging succeeded for app ${appName}`);
                const fileName = `${appName}_v${appVersion}.gin`;

                // Set headers for file download and send the binary data.
                $g.response.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
                $g.response.send(packageBuffer, 200, 'application/zip');
            } else {
                $g.log.error(`Packaging failed for app ${appName}`, { error: 'No buffer returned from packageApp' });
                return $g.response.send({
                    code: 500,
                    error: 'Packaging failed',
                    message: 'Unknown error during packaging'
                }, 500);
            }
        } catch (err) {
            $g.log.error(`Failed to package app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({
                code: 500,
                error: 'Packaging failed',
                message: err.message
            }, 500);
        }
    });
};
