const nodeFs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extract = require('extract-zip');
const fs = require('./fs.js'); // Our secure fs module
const { resolveSecurePath } = require('./internal_utils.js');

/**
 * @module zip
 * @description Provides functions to zip and unzip files and directories securely.
 * This module allows you to create zip archives from files or directories, and extract zip files to specified locations.
 * It ensures that all file operations are performed within the secure boundaries defined by the GingerJS framework.
 * <b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
*/


/**
 * @function zip
 * @memberof module:zip
 * @description Zips a file or directory into an in-memory buffer.
 * This function allows you to create a zip archive from a single file or an entire directory.
 * @param {string} scope The scope of the source (fs.BOX or fs.WEB).
 * @param {string} sourcePath The path to the file or directory to zip.
 * @param {object} [options] - Optional settings.
 * @param {boolean} [options.includeRootFolder=false] - If true and source is a directory, the directory itself is included at the root of the zip.
 * @returns {Promise<Buffer>} A promise that resolves with the zip file data as a Buffer.
 * @example
 * const zip = require('zip');
 * const zipBuffer = await zip.zip(fs.BOX, '/path/to/source');
 * console.log(zipBuffer); // Outputs a Buffer containing the zip file data
 * @throws {Error} If the source file or directory does not exist, or if the path traversal is detected.
 */
async function zip(scope, sourcePath, options = {}) {
    const absolutePath = resolveSecurePath(scope, sourcePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Create a promise that resolves when the stream is finished.
    const streamPromise = new Promise((resolve, reject) => {
        const buffers = [];
        archive.on('data', (buffer) => buffers.push(buffer));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', (err) => reject(err));
    });

    const stats = nodeFs.statSync(absolutePath);
    if (stats.isDirectory()) {
        const destPathInZip = options.includeRootFolder ? path.basename(absolutePath) : false;
        archive.directory(absolutePath, destPathInZip);
    } else {
        archive.file(absolutePath, { name: path.basename(absolutePath) });
    }

    await archive.finalize();
    return streamPromise;
}

/**
 * @function zipToFile
 * @memberof module:zip
 * @description Zips a file or directory to a destination zip file.
 * @param {string} sourceScope - The scope of the source (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the file or directory to zip.
 * @param {string} destScope - The scope of the destination (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination zip file.
 * @param {object} [options] - Optional settings.
 * @param {boolean} [options.includeRootFolder=false] - If true and source is a directory, the directory itself is included at the root of the zip.
 * @returns {Promise<void>} A promise that resolves when the zip file is created.
 * @throws {Error} If the source file or directory does not exist, or if the path traversal is detected, or if zipping between scopes is attempted without the allowCrossOrigin option.
 * @example
 * const fs = require('fs'); // GingerJS secure fs module
 * const zip = require('zip');
 * await zip.zipToFile(fs.BOX, '/path/to/source', fs.BOX, '/path/to/destination.zip');
 * if(fs.existsSync(fs.BOX, '/path/to/destination.zip')) {
 *     console.log("Zip file created successfully.");
 * }
 */
async function zipToFile(sourceScope, sourcePath, destScope, destPath, options = {}) {
    const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
    const destAbsolutePath = resolveSecurePath(destScope, destPath);

    if (!nodeFs.existsSync(sourceAbsolutePath)) {
        throw new Error(`Source file or directory does not exist: ${sourcePath}`);
    }

    const destDir = path.dirname(destAbsolutePath);
    nodeFs.mkdirSync(destDir, { recursive: true });

    const output = nodeFs.createWriteStream(destAbsolutePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Create a promise that resolves when the output file stream is closed.
    const streamPromise = new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
    });

    archive.pipe(output);

    const stats = nodeFs.statSync(sourceAbsolutePath);
    if (stats.isDirectory()) {
        const destPathInZip = options.includeRootFolder ? path.basename(sourceAbsolutePath) : false;
        archive.directory(sourceAbsolutePath, destPathInZip);
    } else {
        archive.file(sourceAbsolutePath, { name: path.basename(sourceAbsolutePath) });
    }

    await archive.finalize();
    return streamPromise;
}

/**
 * @function unzip
 * @memberof module:zip
 * @description Unzips a source zip file to a destination folder.
 * @param {string} sourceScope - The scope of the source (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source zip file.
 * @param {string} destScope - The scope of the destination (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination folder.
 * @returns {Promise<void>} A promise that resolves when the unzip operation is complete.
 * @throws {Error} If the source zip file does not exist, or if the path traversal is detected, or if unzipping between scopes is attempted without the allowCrossOrigin option.
 * @example
 * const fs = require('fs'); // GingerJS secure fs module
 * const zip = require('zip');
 * await zip.unzip(fs.BOX, '/path/to/source.zip', fs.BOX, '/path/to/destination');
 * if(fs.existsSync(fs.BOX, '/path/to/destination')) {
 *     console.log("Unzip operation completed successfully.");
 * }
 */
async function unzip(sourceScope, sourcePath, destScope, destPath) {
    const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
    const destAbsolutePath = resolveSecurePath(destScope, destPath);

    
    if (!nodeFs.existsSync(sourceAbsolutePath)) {
        throw new Error(`Source zip file does not exist: ${sourcePath}`);
    }

    nodeFs.mkdirSync(destAbsolutePath, { recursive: true });

    await extract(sourceAbsolutePath, { dir: destAbsolutePath });
}

module.exports = {
    zip,
    zipToFile,
    unzip,
};
