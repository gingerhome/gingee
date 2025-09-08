module.exports = async function() {
    await ginger(async ($g) => {
        const platform = require('platform');
        try {
            const appName = $g.request.query.app;
            if (!appName) {
                return $g.response.send({ error: 'An `app` query parameter is required.' }, 400);
            }
            
            await platform.reloadApp(appName);
            
            $g.response.send({ status: 'success', message: `App '${appName}' has been successfully reloaded.` });

        } catch (err) {
            $g.log.error(`Failed to reload app '${$g.request.query.app}'`, { error: err.message });
            $g.response.send({ error: 'An internal error occurred while reloading the app.' }, 500);
        }
    });
};