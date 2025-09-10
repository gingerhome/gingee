module.exports = async function() {
    await gingee(async ($g) => {
        const platform = require('platform');
        try {
            const { appName, permissions } = $g.request.body;
            if (!appName || !Array.isArray(permissions)) {
                return $g.response.send({ error: 'A valid `appName` and `permissions` array are required.' }, 400);
            }

            const result = await platform.setAppPermissions(appName, permissions);

            $g.response.send({ status: 'success', message: result.message });

        } catch (err) {
            $g.log.error(`Failed to set permissions for app '${$g.request.body.appName}'`, { error: err.message });
            $g.response.send({ error: 'An internal error occurred while setting permissions.' }, 500);
        }
    });
};
