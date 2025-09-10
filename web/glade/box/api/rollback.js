module.exports = async function() {
    gingee(async ($g) => {
        const platform = require('platform');

        try {
            if ($g.request.method !== 'POST') {
                return $g.response.send({ error: 'Invalid method. This endpoint requires a POST request.' }, 405);
            }
            
            const { appName, permissions } = $g.request.body;
            if (!appName || !Array.isArray(permissions)) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'A valid `appName` and `permissions` array are required in the request body.'
                }, 400);
            }

            // Call the platform module to perform the rollback.
            const result = await platform.rollbackApp(appName, permissions);

            if (result) {
                $g.log.info(`Rollback succeeded for app ${appName}`);
                $g.response.send({
                    code: 200,
                    status: 'success',
                    result: result
                });
            } else {
                $g.log.error(`Rollback failed for app ${appName}`, { error: 'No result returned from rollbackApp' });
                return $g.response.send({
                    code: 500,
                    error: 'Rollback failed',
                    message: 'Unknown error during rollback'
                }, 500);
            }
        } catch (err) {
            $g.log.error(`Failed to roll back app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({
                code: 500,
                error: 'Rollback failed',
                message: err.message
            }, 500);
        }
    });
};
