module.exports = async function () {
    ginger(async ($g) => {
        const platform = require('platform');

        try {
            // The file buffer and text fields are available in $g.request.body.
            const appName = $g.request.body.appName ? $g.request.body.appName[0] : null;
            const uploadedFile = $g.request.body.files ? $g.request.body.files.package : null;

            const permissionsString = $g.request.body.permissions ? $g.request.body.permissions[0] : '[]';
            let permissions = [];
            try {
                permissions = JSON.parse(permissionsString);
                if (!Array.isArray(permissions)) {
                    throw new Error("Permissions field is not a valid JSON array.");
                }
            } catch (e) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: `Invalid permissions format: ${e.message}`
                }, 400);
            }

            // Validate the input from the request body.
            if (!appName || !uploadedFile) {
                // Use the $g.response object to send a client error.
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'appName field and a `package` file upload are required.'
                }, 400);
            }

            // The file data is already loaded into a Buffer for us.
            const packageBuffer = uploadedFile.data;
            
            // Call the platform module to perform the installation.
            const result = await platform.installApp(appName, packageBuffer, permissions);
            if (!result) {
                // If the installation failed, send an error response.
                $g.log.error(`Installation failed for app ${appName}`, { error: 'No result returned from installApp' });
                return $g.response.send({
                    code: 500,
                    error: 'Installation failed',
                    message: 'Unknown error during installation'
                }, 500);
            } else {
                $g.log.info(`Installation succeeded for app ${appName}`);
                // Send a success response.
                $g.response.send({
                    code: 200,
                    status: 'success',
                    result: result
                });
            }

        } catch (err) {
            // Log the detailed error on the server.
            $g.log.error(`Failed to install app`, { error: err.message, stack: err.stack });

            // Send a generic, safe error message to the client.
            $g.response.send({
                code: 500,
                error: 'Installation failed',
                message: err.message
            }, 500);
        }
    });
};
