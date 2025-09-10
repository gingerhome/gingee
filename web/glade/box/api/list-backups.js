module.exports = async function() {
    gingee(async ($g) => {
        const platform = require('platform');

        try {
            // Get the appName from the query parameters.
            const appName = $g.request.query.app;

            if (!appName) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'An `app` query parameter is required.'
                }, 400);
            }

            // Call the platform module to get the list of backups.
            const backups = platform.listBackups(appName);

            // This function is synchronous and returns an array, so we don't need to check for a falsy result
            // unless an empty array is considered a failure, which it is not.
            $g.response.send({
                code: 200,
                status: 'success',
                backups: backups
            });

        } catch (err) {
            $g.log.error(`Failed to list backups for app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({
                code: 500,
                error: 'Failed to list backups',
                message: err.message
            }, 500);
        }
    });
};
