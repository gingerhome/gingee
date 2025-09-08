const path = require('path');
const { getContext } = require('./ginger.js');

const SCOPES = {
  BOX: 'BOX',
  WEB: 'WEB'
};

/**
 * A secure, internal-only path resolver.
 * @private
 */
function resolveSecurePath(scope, userPath) {
  const ctx = getContext();
  const app = ctx.app;

  const appBoxPath = app.appBoxPath;
  const appWebPath = app.appWebPath;

  let basePath;
  let finalUserPath = userPath;

  if (userPath.startsWith('/')) {
    const pathSegments = userPath.split('/').filter(Boolean);
    const firstSegment = pathSegments[0];

    if (firstSegment === app.id) { // app.id is the appName
      finalUserPath = path.join('/', ...pathSegments.slice(1));
    }

    basePath = (scope === SCOPES.BOX) ? appBoxPath : appWebPath;
    finalUserPath = finalUserPath.substring(1);

  } else {
    basePath = ctx.scriptFolder;
    if (scope === SCOPES.WEB) {
      basePath = basePath.replace(appBoxPath, appWebPath);
    }
  }

  const requestedPath = path.join(basePath, finalUserPath);
  const secureBoundary = (scope === SCOPES.BOX) ? appBoxPath : appWebPath;

  const resolved = path.resolve(requestedPath);
  if (!resolved.startsWith(secureBoundary)) {
    throw new Error(`Path Traversal Error: Access to '${userPath}' is forbidden!`);
  }

  return resolved;
}

module.exports = {
  SCOPES,
  resolveSecurePath
};
