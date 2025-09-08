module.exports = async function() {
    await ginger(async ($g) => {
        const platform = require('platform');
        try {
            const appName = $g.request.query.app;
            if (!appName) {
                return $g.response.send({ error: 'An `app` query parameter is required.' }, 400);
            }

            const permissionsData = await platform.getAppPermissions(appName);
            
            $g.response.send({ status: 'success', ...permissionsData });

        } catch (err) {
            $g.log.error(`Failed to get permissions for app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({ error: 'An internal error occurred while fetching permissions.' }, 500);
        }
    });
};