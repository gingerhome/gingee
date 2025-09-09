const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const fg = require('fast-glob');

/**
 * Creates a .gin package buffer from a source app directory.
 * This is a specialized, build-time function.
 * @param {string} appName - The name of the app to package (e.g., 'glade').
 * @param {string} projectRoot - The absolute path to the main project.
 * @returns {Promise<Buffer>} A promise that resolves with the package buffer.
 */
async function createGinPackage(appName, projectRoot) {
    console.log(`   -> Starting package process for '${appName}'...`);

    const appWebPath = path.join(projectRoot, 'web', appName);
    const appBoxPath = path.join(appWebPath, 'box');
    const manifestPath = path.join(appBoxPath, '.gpkg');
    const appConfigPath = path.join(appBoxPath, 'app.json');

    // Create a temporary directory for our sanitized files.
    const tempAppPath = path.join(projectRoot, 'temp', `build-${appName}-${Date.now()}`);
    fs.copySync(appWebPath, tempAppPath); // Copy the entire app to a temp location

    const tempAppConfigPath = path.join(tempAppPath, 'box', 'app.json');
    if (fs.existsSync(tempAppConfigPath)) {
        const appConfig = fs.readJsonSync(tempAppConfigPath);
        // Reset the env object to safe, non-secret defaults in the temporary copy.
        appConfig.env = {
            "ADMIN_USERNAME": "admin",
            "ADMIN_PASSWORD_HASH": "!!!_NEEDS_TO_BE_GENERATED_BY_CLI_!!!"
        };
        fs.writeJsonSync(tempAppConfigPath, appConfig, { spaces: 2 });
        console.log(`   -> Sanitized temporary app.json for '${appName}'.`);
    }

    let filesToInclude = [];
    let globOptions = {
        cwd: tempAppPath, // IMPORTANT: Run the glob against the temporary, sanitized directory
        onlyFiles: true,
        dot: true
    };

    if (fs.existsSync(manifestPath)) {
        const manifest = fs.readJsonSync(manifestPath);
        const excludePatterns = (manifest.exclude || []).concat(['.gpkg']);
        globOptions.ignore = excludePatterns;
        filesToInclude = await fg(manifest.include || ['**/*'], globOptions);
    } else {
        globOptions.ignore = ['node_modules/**', '.git/**', 'box/logs/**', '.gpkg'];
        filesToInclude = await fg(['**/*'], globOptions);
    }

    console.log(`   -> Found ${filesToInclude.length} files to include.`);

    // --- Create the Archive from the TEMPORARY directory ---
    const archive = archiver('zip', { zlib: { level: 9 } });
    const buffers = [];
    archive.on('data', buffer => buffers.push(buffer));
    const streamPromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);
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
 * This script builds the distributable 'gingerjs' package from the source.
 * It copies the necessary engine files and generates a clean, production-ready package.json.
 */
async function buildPackage() {
    try {
        console.log('Starting GingerJS package build...');

        // Define Paths based on the new project structure
        const projectRoot = path.resolve(__dirname, '..');
        const packageDest = path.join(projectRoot, 'build', 'dist', 'gingerjs');

        // Clean the destination directory
        console.log(`Cleaning destination: ${packageDest}`);
        fs.emptyDirSync(packageDest);

        // Create the glade.gin package using our new safe function
        console.log('Building core `glade` application package...');
        const gladePackageBuffer = await createGinPackage('glade', projectRoot);

        // Copy essential source files and directories
        console.log('Copying engine source files...');
        const templatesDest = path.join(packageDest, 'templates');
        fs.mkdirSync(templatesDest);
        fs.writeFileSync(path.join(templatesDest, 'glade.gin'), gladePackageBuffer);

        fs.copySync(path.join(projectRoot, 'ginger.js'), path.join(packageDest, 'ginger.js'));
        fs.copySync(path.join(projectRoot, 'modules'), path.join(packageDest, 'modules'));
        fs.copySync(path.join(projectRoot, 'LICENSE'), path.join(packageDest, 'LICENSE'));
        fs.copySync(path.join(projectRoot, 'README.md'), path.join(packageDest, 'README.md'));

        fs.copySync(path.join(projectRoot, 'settings', 'fonts'), path.join(packageDest, 'settings', 'fonts'));
        const sslPath = path.join(packageDest, 'settings', 'ssl');
        //create ssl directory
        fs.mkdirSync(sslPath);

        const permissionsFilePath = path.join(packageDest, 'settings', 'permissions.json');
        fs.writeJsonSync(permissionsFilePath, {}, { spaces: 2 });
        console.log('   -> Created default empty permissions.json.');

        // Generate the production package.json
        console.log('Generating production package.json...');
        const sourcePackageJson = require(path.join(projectRoot, 'package.json'));

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
                ".": "./ginger.js",
                "./templates/glade.gin": "./templates/glade.gin"
            }
        };

        fs.writeFileSync(
            path.join(packageDest, 'package.json'),
            JSON.stringify(distPackageJson, null, 2)
        );

        console.log('\n\x1b[32m%s\x1b[0m', `✅ GingerJS engine package created successfully!`);
        console.log(`   Output location: ${packageDest}`);

    } catch (err) {
        console.error('\x1b[31m%s\x1b[0m', 'Build failed:');
        console.error(err);
        process.exit(1);
    }
}

buildPackage();
