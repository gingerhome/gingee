module.exports = async function() {
    ginger(async ($g) => {
        const platform = require('platform');

        try {
            // The request body is pre-parsed by the ginger() middleware.
            const appName = $g.request.body.appName ? $g.request.body.appName[0] : null;
            const uploadedFile = $g.request.body.files ? $g.request.body.files.package : null;

            const permissionsString = $g.request.body.permissions ? $g.request.body.permissions[0] : '[]';
            let permissions = [];
            try {
                // During an upgrade, the permissions are usually re-confirmed.
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

            if (!appName || !uploadedFile) {
                return $g.response.send({
                    code: 400,
                    error: 'Bad Request',
                    message: 'appName field and a `package` file upload are required.'
                }, 400);
            }

            const packageBuffer = uploadedFile.data;

            // Call the platform module to perform the upgrade.
            const result = await platform.upgradeApp(appName, packageBuffer, permissions);

            if (result) {
                $g.log.info(`Upgrade succeeded for app ${appName}`);
                $g.response.send({
                    code: 200,
                    status: 'success',
                    result: result
                });
            } else {
                $g.log.error(`Upgrade failed for app ${appName}`, { error: 'No result returned from upgradeApp' });
                return $g.response.send({
                    code: 500,
                    error: 'Upgrade failed',
                    message: 'Unknown error during upgrade'
                }, 500);
            }
        } catch (err) {
            $g.log.error(`Failed to upgrade app`, { error: err.message, stack: err.stack });
            $g.response.send({
                code: 500,
                error: 'Upgrade failed',
                message: err.message
            }, 500);
        }
    });
};
