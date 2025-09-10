module.exports = async function () {
    gingee(async ($g) => {
        const platform = require('platform');

        try {
            // Get the appName from the query parameters
            const appName = $g.request.query.app;

            if (!appName) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'An `app` query parameter is required.'
                }, 400);
            }

            //Call the platform module to perform the deletion.
            const result = await platform.deleteApp(appName);
            if (!result) {
                // If the deletion failed, send an error response.
                $g.log.error(`Deletion failed for app ${appName}`, { error: 'No result returned from deleteApp' });
                return $g.response.send({
                    code: 500,
                    error: 'Deletion failed',
                    message: 'Unknown error during deletion'
                }, 500);
            } else {
                $g.log.info(`Deletion succeeded for app ${appName}`);
                //Send a success response.
                $g.response.send({
                    code: 200,
                    status: 'success',
                    result: result
                });
            }

        } catch (err) {
            // Log the detailed error on the server.
            $g.log.error(`Failed to delete app '${$g.request.query.app}'`, { error: err.message });

            // Send a generic, safe error message to the client.
            $g.response.send({
                code: 500,
                error: 'Deletion failed',
                message: err.message
            }, 500);
        }
    });
};
