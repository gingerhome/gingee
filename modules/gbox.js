const nodeFs = require('fs');
const path = require('path');
const sucrase = require('sucrase');

// List of app modules that require a permission check
const PROTECTED_MODULES = [
  'cache',
  'db', 
  'fs', 
  'httpclient', 
  'platform',
  'pdf',
  'zip',
  'image'
];

// A whitelist of globally-allowed, safe UTILITY modules (both built-in and third-party).
const globallyAllowedModules = [
  "url",          // built-in
  "querystring",  // built-in
  "mime-types"    // third-party
];

const restrictedGlobalModules = [
  'gingee', 
  'gbox', 
  'gapp-start',
  'cache_service',
  'internal_utils',
  'platform'
];

const gingee = require('./gingee.js');
const transpileCache = new Map();

// The list of safe modules is now a parameter.
function createGRequire(callingScriptPath, gBoxConfig) {
  return function gRequire(moduleName) {

    // Check if the module is a protected module
    if (PROTECTED_MODULES.includes(moduleName)) {
        const granted = gBoxConfig.app.grantedPermissions || [];
        if (!granted.includes(moduleName)) {
            throw new Error(`Security Error: The app '${gBoxConfig.app.name}' has not been granted permission to access the '${moduleName}' module. Please grant permission in Glade or settings/permissions.json.`);
        }
    }
    
    //Check if the module is a restricted module
    if (restrictedGlobalModules.includes(moduleName)) {
      const { appName } = gingee.getContext(); // Get the app that is making the call.
      // Check if the current app's ID is in the privileged list.
      if (gBoxConfig.privilegedApps && gBoxConfig.privilegedApps.includes(appName)) {
        // If it is, allow the require to proceed.
        return require(`./${moduleName}.js`);
      } else {
        // If not, throw a hard security error.
        throw new Error(`Security Error: The app '${appName}' does not have permission to access the '${moduleName}' module.`);
      }
    }

    // --- RULE 2: Module with relative path check ---
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      const scriptDir = path.dirname(callingScriptPath);
      let targetPath = path.resolve(scriptDir, moduleName);

      // Append .js if no extension is provided
      if (!path.extname(targetPath)) {
        targetPath += '.js';
      }

      // --- SECURITY CHECK ---
      // Ensure the resolved path is still inside the app's secure 'box' folder.
      if (!targetPath.startsWith(gBoxConfig.appBoxPath)) {
        throw new Error(`Path traversal detected. Access to '${moduleName}' is forbidden.`);
      }

      if (!nodeFs.existsSync(targetPath)) {
        throw new Error(`Cannot find local module '${moduleName}' at resolved path: ${targetPath}`);
      }

      // Recursively run the new script in the same sandboxed configuration.
      return runInGBox(targetPath, gBoxConfig);
    }

    // --- RULE 2: Global `modules` Folder Check ---
    const globalModulePath = path.join(gBoxConfig.globalModulesPath, moduleName + '.js');
    if (nodeFs.existsSync(globalModulePath)) {
      return require(globalModulePath);
    }

    // --- RULE 3: Globally Allowed and Built-in Module Check ---
    const appAllowedBuiltins = gBoxConfig.allowedBuiltinModules || [];
    if (globallyAllowedModules.includes(moduleName) || appAllowedBuiltins.includes(moduleName)) {
      return require(moduleName);
    }

    // --- RULE 4: NEW - App-Box-Relative Path Check (for default_includes) ---
    // This rule catches paths like 'utils/formatters.js' which don't start with './'
    // but are not global modules. We treat them as relative to the app's box root.
    const appBoxRelativePath = path.resolve(gBoxConfig.appBoxPath, moduleName);
    if (nodeFs.existsSync(appBoxRelativePath)) {
      // We still must verify it's inside the boundary, although it's very likely.
      if (!appBoxRelativePath.startsWith(gBoxConfig.appBoxPath)) {
        throw new Error(`Path traversal detected. Access to '${moduleName}' is forbidden.`);
      }
      return runInGBox(appBoxRelativePath, gBoxConfig);
    }

    // --- RULE 5: Deny ---
    throw new Error(`Module '${moduleName}' is not allowed or could not be found.`);
  };
}

// The list of allowed modules is now passed in here.
function runInGBox(scriptPath, gBoxConfig) {
  let scriptCode;

  if (gBoxConfig.useCache && transpileCache.has(scriptPath)) {
    scriptCode = transpileCache.get(scriptPath);
    gBoxConfig.logger.info(`[CACHE HIT] for script: ${path.basename(scriptPath)}`);
  } else {
    transpileCache.delete(scriptPath); // Clear cache entry if it exists
    const originalCode = nodeFs.readFileSync(scriptPath, 'utf8');

    // --- THIS IS THE NEW ESM "SNIFF TEST" ---
    // This regex looks for 'import' or 'export' at the beginning of a line (or the file)
    // or after a semicolon, which is a good indicator of a top-level statement.
    const isEsModule = /^(import|export)\s|;s*(import|export)\s/.test(originalCode);

    if (isEsModule) {
      // If it's likely an ESM file, transpile it.
      gBoxConfig.logger.info(`ESM detected, transpiling: ${path.basename(scriptPath)}`);
      const transformed = sucrase.transform(originalCode, {
        transforms: ['imports', 'jsx', 'typescript']
      });
      scriptCode = transformed.code;
    } else {
      // Otherwise, assume it's CommonJS and use the code as-is.
      scriptCode = originalCode;
    }

    if (gBoxConfig.useCache) {
      // Store the final code (whether transformed or not) in the cache.
      transpileCache.set(scriptPath, scriptCode);
      gBoxConfig.logger.info(`[CACHE SET] for script: ${path.basename(scriptPath)}`);
    }
  }

  const gbox = {
    module: { exports: {} },
    gingee: gingee.gingee,
    console: console,
    // Pass the list down to create the safe require function.
    require: createGRequire(scriptPath, gBoxConfig)
  };

  const scriptWrapper = new Function(
    'module',
    'exports',
    'gingee',
    'console',
    'require',
    scriptCode
  );

  scriptWrapper(
    gbox.module,
    gbox.module.exports,
    gbox.gingee,
    gbox.console,
    gbox.require
  );

  return gbox.module.exports;
}

module.exports = {
  transpileCache,
  createGRequire,
  runInGBox
};
