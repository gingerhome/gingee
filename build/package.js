const fs = require("fs-extra");
const path = require("path");
const archiver = require("archiver");
const fg = require("fast-glob");

/**
 * Produce a project-scaffold gingee.json from the engine repo's gingee.json.
 * Keeps structure/features in sync with the engine while stripping local-dev
 * and secret-bearing values so new CLI projects get a safe starter config.
 *
 * @param {object} sourceConfig - Parsed gingee.json from the engine project
 * @returns {object} Sanitized config suitable for gingee-cli/templates/project/
 */
function sanitizeGingeeJsonForCliTemplate(sourceConfig) {
  const out = JSON.parse(JSON.stringify(sourceConfig || {}));

  // Never ship runtime-resolved absolute roots
  if (out.box && out.box.localModulesPaths) {
    delete out.box.localModulesPaths;
  }

  // Canonical HTTP port for new projects (not the developer's local port)
  out.server = out.server || {};
  out.server.http = Object.assign({}, out.server.http || {}, {
    enabled: true,
    port: 7070,
  });
  out.server.https = Object.assign({}, out.server.https || {}, {
    enabled: false,
    port: 7443,
    key_file: "settings/ssl/key.pem",
    cert_file: "settings/ssl/cert.pem",
  });
  out.server.https.enabled = false;

  // Quiet default logs for scaffolds
  out.logging = out.logging || {};
  out.logging.level = "error";
  out.logging.rotation = Object.assign(
    { period_days: 7, max_size_mb: 50 },
    out.logging.rotation || {},
  );

  // Box: empty allowlist / local_modules by default; production-safe codegen default
  out.box = out.box || {};
  out.box.allowed_modules = Array.isArray(out.box.allowed_modules)
    ? out.box.allowed_modules
    : [];
  out.box.local_modules = [];
  if (typeof out.box.allow_dynamic_code !== "boolean") {
    out.box.allow_dynamic_code = false;
  }
  delete out.box.localModulesPaths;

  // Scrub credentials / tokens from shared redis-style blocks
  const scrubRedis = (block) => {
    if (!block || typeof block !== "object" || !block.redis) return;
    block.redis.url = null;
    block.redis.password = null;
  };
  scrubRedis(out.cache);
  scrubRedis(out.scheduler);
  scrubRedis(out.websockets);
  scrubRedis(out.queue);

  if (out.metrics && typeof out.metrics === "object") {
    out.metrics.bearer_token = null;
  }

  // Secrets: keep relative roots; allow common /run/secrets; drop other absolutes
  if (out.secrets && typeof out.secrets === "object") {
    out.secrets.load_dotenv = false;
    const roots = Array.isArray(out.secrets.file_roots)
      ? out.secrets.file_roots
      : ["./settings/secrets"];
    out.secrets.file_roots = roots.filter((r) => {
      if (typeof r !== "string" || !r) return false;
      if (r === "/run/secrets") return true;
      return !path.isAbsolute(r);
    });
    if (out.secrets.file_roots.length === 0) {
      out.secrets.file_roots = ["./settings/secrets"];
    }
  }

  // Isolation apps/groups should start empty for a new project
  if (out.isolation && typeof out.isolation === "object") {
    out.isolation.apps = [];
    out.isolation.groups = {};
  }

  // Stable privileged set for scaffolds
  if (!Array.isArray(out.privileged_apps) || out.privileged_apps.length === 0) {
    out.privileged_apps = ["glade"];
  }

  out.default_app = out.default_app || "glade";
  out.web_root = out.web_root || "./web";

  return out;
}

/**
 * Write sanitized gingee.json into the sibling gingee-cli project template.
 * @param {string} projectRoot
 * @param {string} cliTemplatesPath - .../gingee-cli/templates
 */
function syncCliProjectGingeeJson(projectRoot, cliTemplatesPath) {
  const sourcePath = path.join(projectRoot, "gingee.json");
  if (!fs.existsSync(sourcePath)) {
    console.warn(
      "   -> Skipping CLI gingee.json sync: engine gingee.json not found.",
    );
    return;
  }
  const destDir = path.join(cliTemplatesPath, "project");
  if (!fs.existsSync(path.dirname(cliTemplatesPath))) {
    console.warn(
      `   -> Skipping CLI gingee.json sync: gingee-cli not found at ${path.dirname(cliTemplatesPath)}.`,
    );
    return;
  }
  fs.ensureDirSync(destDir);
  const sourceConfig = fs.readJsonSync(sourcePath);
  const sanitized = sanitizeGingeeJsonForCliTemplate(sourceConfig);
  const destPath = path.join(destDir, "gingee.json");
  fs.writeJsonSync(destPath, sanitized, { spaces: 2 });
  console.log(`   -> Wrote sanitized gingee.json → ${destPath}`);
}

/**
 * Creates a .gin package buffer from a source app directory.
 * This is a specialized, build-time function.
 * @param {string} appName - The name of the app to package (e.g., 'glade').
 * @param {string} projectRoot - The absolute path to the main project.
 * @returns {Promise<Buffer>} A promise that resolves with the package buffer.
 */
async function createGinPackage(appName, projectRoot) {
  console.log(`   -> Starting package process for '${appName}'...`);

  const appWebPath = path.join(projectRoot, "web", appName);
  const appBoxPath = path.join(appWebPath, "box");
  const manifestPath = path.join(appBoxPath, ".gpkg");
  const appConfigPath = path.join(appBoxPath, "app.json");

  // Create a temporary directory for our sanitized files.
  const tempAppPath = path.join(
    projectRoot,
    "temp",
    `build-${appName}-${Date.now()}`,
  );
  fs.copySync(appWebPath, tempAppPath); // Copy the entire app to a temp location

  const tempAppConfigPath = path.join(tempAppPath, "box", "app.json");
  if (fs.existsSync(tempAppConfigPath)) {
    const appConfig = fs.readJsonSync(tempAppConfigPath);
    // Reset the env object to safe, non-secret defaults in the temporary copy.
    appConfig.env = {
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD_HASH: "!!!_NEEDS_TO_BE_GENERATED_BY_CLI_!!!",
    };
    fs.writeJsonSync(tempAppConfigPath, appConfig, { spaces: 2 });
    console.log(`   -> Sanitized temporary app.json for '${appName}'.`);
  }

  let filesToInclude = [];
  let globOptions = {
    cwd: tempAppPath, // IMPORTANT: Run the glob against the temporary, sanitized directory
    onlyFiles: true,
    dot: true,
  };

  if (fs.existsSync(manifestPath)) {
    const manifest = fs.readJsonSync(manifestPath);
    const excludePatterns = (manifest.exclude || []).concat([".gpkg"]);
    globOptions.ignore = excludePatterns;
    filesToInclude = await fg(manifest.include || ["**/*"], globOptions);
  } else {
    globOptions.ignore = ["node_modules/**", ".git/**", "box/logs/**", ".gpkg"];
    filesToInclude = await fg(["**/*"], globOptions);
  }

  console.log(`   -> Found ${filesToInclude.length} files to include.`);

  // --- Create the Archive from the TEMPORARY directory ---
  // archiver v8+: class API (not archiver('zip', opts))
  const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
  const buffers = [];
  archive.on("data", (buffer) => buffers.push(buffer));
  const streamPromise = new Promise((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(buffers)));
    archive.on("error", reject);
  });

  for (const file of filesToInclude) {
    archive.file(path.join(tempAppPath, file), { name: file });
  }

  await archive.finalize();

  // Clean up the temporary directory
  fs.removeSync(tempAppPath);

  console.log(`   -> Package buffer created for '${appName}'.`);
  return streamPromise;
}

/**
 * This script builds the distributable 'gingee' package from the source.
 * It copies the necessary engine files and generates a clean, production-ready package.json.
 */
async function buildPackage() {
  try {
    console.log("Starting Gingee package build...");

    // Define Paths based on the new project structure
    const projectRoot = path.resolve(__dirname, "..");
    const packageDest = path.join(projectRoot, "build", "dist", "gingee");
    const cliTemplatesPath = path.resolve(
      projectRoot,
      "../gingee-cli/templates",
    );

    // Clean the destination directory
    console.log(`Cleaning destination: ${packageDest}`);
    fs.emptyDirSync(packageDest);

    // Create the glade.gin package using our new safe function
    console.log("Building core `glade` application package...");
    const gladePackageBuffer = await createGinPackage("glade", projectRoot);

    console.log(`Copying 'glade.gin' to the gingee-cli package...`);
    fs.ensureDirSync(cliTemplatesPath);
    fs.writeFileSync(
      path.join(cliTemplatesPath, "glade.gin"),
      gladePackageBuffer,
    );

    // Keep CLI project scaffold config aligned with engine gingee.json (sanitized).
    console.log("Syncing sanitized gingee.json to gingee-cli project template...");
    syncCliProjectGingeeJson(projectRoot, cliTemplatesPath);

    // Copy essential source files and directories
    console.log("Copying engine source files...");
    const templatesDest = path.join(packageDest, "templates");
    fs.mkdirSync(templatesDest);
    fs.writeFileSync(path.join(templatesDest, "glade.gin"), gladePackageBuffer);

    fs.copySync(
      path.join(projectRoot, "gingee.js"),
      path.join(packageDest, "gingee.js"),
    );
    fs.copySync(
      path.join(projectRoot, "modules"),
      path.join(packageDest, "modules"),
    );
    fs.copySync(
      path.join(projectRoot, "LICENSE"),
      path.join(packageDest, "LICENSE"),
    );
    fs.copySync(
      path.join(projectRoot, "README.md"),
      path.join(packageDest, "README.md"),
    );

    fs.copySync(
      path.join(projectRoot, "settings", "fonts"),
      path.join(packageDest, "settings", "fonts"),
    );
    const sslPath = path.join(packageDest, "settings", "ssl");
    //create ssl directory
    fs.mkdirSync(sslPath);

    const permissionsFilePath = path.join(
      packageDest,
      "settings",
      "permissions.json",
    );
    fs.writeJsonSync(permissionsFilePath, {}, { spaces: 2 });
    console.log("   -> Created default empty permissions.json.");

    // Generate the production package.json
    console.log("Generating production package.json...");
    const sourcePackageJson = require(path.join(projectRoot, "package.json"));

    const distPackageJson = {
      name: sourcePackageJson.name,
      version: sourcePackageJson.version,
      description: sourcePackageJson.description,
      main: sourcePackageJson.main,
      repository: sourcePackageJson.repository,
      bugs: sourcePackageJson.bugs,
      homepage: sourcePackageJson.homepage,
      keywords: sourcePackageJson.keywords,
      author: sourcePackageJson.author,
      contributors: sourcePackageJson.contributors,
      license: sourcePackageJson.license,
      engines: sourcePackageJson.engines,
      genai: sourcePackageJson.genai,
      // CRITICAL: Only include production dependencies
      dependencies: sourcePackageJson.dependencies,
      exports: {
        ".": "./gingee.js",
        "./templates/glade.gin": "./templates/glade.gin",
      },
    };

    fs.writeFileSync(
      path.join(packageDest, "package.json"),
      JSON.stringify(distPackageJson, null, 2),
    );

    console.log(
      "\n\x1b[32m%s\x1b[0m",
      `✅ Gingee engine package created successfully!`,
    );
    console.log(`   Output location: ${packageDest}`);
  } catch (err) {
    console.error("\x1b[31m%s\x1b[0m", "Build failed:");
    console.error(err);
    process.exit(1);
  }
}

module.exports = {
  sanitizeGingeeJsonForCliTemplate,
  syncCliProjectGingeeJson,
  createGinPackage,
  buildPackage,
};

if (require.main === module) {
  buildPackage();
}
