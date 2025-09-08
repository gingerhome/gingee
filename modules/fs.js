const nodeFs = require('fs');
const nodeFsPromises = require('fs/promises');
const path = require('path');
const { SCOPES, resolveSecurePath } = require('./internal_utils.js');

/**
 * @module fs
 * @description A secure file system module for GingerJS that provides secure sandboxed synchronous and asynchronous file operations.
 * <b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

// FS Wrapper functions

/**
 * @function readFileSync
 * @memberof module:fs
 * @description Synchronously reads the entire contents of a file.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {string | Buffer} The contents of the file.
 * @throws {Error} If the file does not exist or is outside the secure scope.
 * @example
 * const content = fs.readFileSync(fs.BOX, 'data/myfile.txt', 'utf8');
 * console.log(content); // Outputs the content of myfile.txt
 */
function readFileSync(scope, filePath, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  return nodeFs.readFileSync(absolutePath, options);
}

/**
 * @function readJSONSync
 * @memberof module:fs
 * @description Synchronously reads a JSON file and parses it.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If the file does not exist or is outside the secure scope or it is not valid JSON.
 * @example
 * const data = fs.readJSONSync(fs.BOX, 'data/myfile.json');
 * console.log(data); // Outputs the parsed JSON object
 */
function readJSONSync(scope, filePath, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  const data = nodeFs.readFileSync(absolutePath, options);
  return JSON.parse(data);
}

/**
 * @function writeFileSync
 * @memberof module:fs
 * @description Synchronously writes data to a file, creating directories as needed.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {string | Buffer} data - The data to write to the file.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {void}
 * @throws {Error} If the file path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.writeFileSync(fs.BOX, 'data/myfile.txt', 'Hello, World!', 'utf8');
 */
function writeFileSync(scope, filePath, data, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  const dir = path.dirname(absolutePath);
  nodeFs.mkdirSync(dir, { recursive: true });
  return nodeFs.writeFileSync(absolutePath, data, options);
}

/**
 * @function appendFileSync
 * @memberof module:fs
 * @description Synchronously appends data to a file, creating directories as needed.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {string | Buffer} data - The data to append to the file.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {void}
 * @throws {Error} If the file path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.appendFileSync(fs.BOX, 'data/myfile.txt', 'Hello, World!', 'utf8');
 */
function appendFileSync(scope, filePath, data, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  const dir = path.dirname(absolutePath);
  nodeFs.mkdirSync(dir, { recursive: true });
  return nodeFs.appendFileSync(absolutePath, data, options);
}

/**
 * @function writeJSONSync
 * @memberof module:fs
 * @description Synchronously writes a JSON object to a file, creating directories as needed.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {object} data - The JSON object to write to the file.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {void}
 * @throws {Error} If the file path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.writeJSONSync(fs.BOX, 'data/myfile.json', { key: 'value' });
 */
function writeJSONSync(scope, filePath, data, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  const dir = path.dirname(absolutePath);
  nodeFs.mkdirSync(dir, { recursive: true });
  return nodeFs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), options);
}

/**
 * @function existsSync
 * @memberof module:fs
 * @description Synchronously checks if a file exists.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @returns {boolean} True if the file exists, false otherwise.
 * @example
 * const exists = fs.existsSync(fs.BOX, 'data/myfile.txt');
 * console.log(exists); // Outputs true if myfile.txt exists, false otherwise
 */
function existsSync(scope, filePath) {
  try {
    const absolutePath = resolveSecurePath(scope, filePath);
    return nodeFs.existsSync(absolutePath);
  } catch (e) {
    return false;
  }
}

/**
 * @function deleteFileSync
 * @memberof module:fs
 * @description Synchronously deletes a file.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @returns {void}
 * @throws {Error} If the file does not exist or is outside the secure scope.
 * @example
 * fs.deleteFileSync(fs.BOX, 'data/myfile.txt');
 */
function deleteFileSync(scope, filePath) {
  const absolutePath = resolveSecurePath(scope, filePath);
  return nodeFs.unlinkSync(absolutePath);
}

/**
 * @function moveFileSync
 * @memberof module:fs
 * @description Synchronously moves a file from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source file (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source file, relative to the source scope.
 * @param {string} destScope - The scope of the destination file (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination file, relative to the destination scope.
 * @returns {string} The new absolute path of the moved file.
 * @throws {Error} if the source file does not exist.
 * @example
 * const newPath = fs.moveFileSync(fs.BOX, 'data/myfile.txt', fs.BOX, 'data/archived/myfile.txt');
 */
function moveFileSync(sourceScope, sourcePath, destScope, destPath) {
  //check for source path existence
  if (!existsSync(sourceScope, sourcePath)) {
    throw new Error(`Source file ${sourcePath} does not exist.`);
  }

  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  nodeFs.mkdirSync(path.dirname(destAbsolutePath), { recursive: true });
  return nodeFs.renameSync(sourceAbsolutePath, destAbsolutePath);
}

/**
 * @function copyFileSync
 * @memberof module:fs
 * @description Synchronously copies a file from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source file (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source file, relative to the source scope.
 * @param {string} destScope - The scope of the destination file (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination file, relative to the destination scope.
 * @returns {void}
 * @throws {Error} if the source file does not exist.
 * @example
 * fs.copyFileSync(fs.BOX, 'data/myfile.txt', fs.BOX, 'data/backup/myfile.txt');
 */
function copyFileSync(sourceScope, sourcePath, destScope, destPath) {
  // Check if the source file exists
  if (!existsSync(sourceScope, sourcePath)) {
    throw new Error(`Source file ${sourcePath} does not exist.`);
  }

  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  nodeFs.mkdirSync(path.dirname(destAbsolutePath), { recursive: true });
  return nodeFs.copyFileSync(sourceAbsolutePath, destAbsolutePath);
}

/**
 * @function mkdirSync
 * @memberof module:fs
 * @description Synchronously creates a directory and its parent directories if they do not exist.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} dirPath - The path to the directory, relative to the scope or script.
 * @returns {void}
 * @throws {Error} If the directory path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.mkdirSync(fs.BOX, 'data/newdir');
 */
function mkdirSync(scope, dirPath) {
  const absolutePath = resolveSecurePath(scope, dirPath);
  // Using { recursive: true } is a safe and common default.
  return nodeFs.mkdirSync(absolutePath, { recursive: true });
}

/**
 * @function rmdirSync
 * @memberof module:fs
 * @description Synchronously removes a directory.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} dirPath - The path to the directory, relative to the scope or script.
 * @param {object} [options] - Options for the removal. 
 *  - `recursive`: If true, removes the directory and its contents recursively.
 * @returns {void}
 * @throws {Error} If the directory is not empty and `recursive` is false.
 * @example
 * fs.rmdirSync(fs.BOX, 'data/oldDir', { recursive: true });
 */
function rmdirSync(scope, dirPath, options = {}) {
  const absolutePath = resolveSecurePath(scope, dirPath);
  if (options.recursive) {
    // fs.rmSync is the modern way to remove recursively.
    return nodeFs.rmSync(absolutePath, { recursive: true, force: true });
  }
  return nodeFs.rmdirSync(absolutePath);
}

/**
 * @function moveDirSync
 * @memberof module:fs
 * @description Synchronously moves a directory from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source directory (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source directory, relative to the source scope.
 * @param {string} destScope - The scope of the destination directory (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination directory, relative to the destination scope.
 * @returns {string} The new absolute path of the moved directory.
 * @throws {Error} if the source directory does not exist.
 * @example
 * fs.moveDirSync(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir');
 */
const moveDirSync = moveFileSync; // Alias for consistency with moveFileSync

/**
 * @function copyDirSync
 * @memberof module:fs
 * @description Synchronously copies a directory from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source directory (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source directory, relative to the source scope.
 * @param {string} destScope - The scope of the destination directory (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination directory, relative to the destination scope.
 * @returns {void}
 * @throws {Error} if the source directory does not exist.
 * @example
 * fs.copyDirSync(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir');
 */
function copyDirSync(sourceScope, sourcePath, destScope, destPath) {
  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  // fs.cpSync handles directory creation and recursive copying.
  return nodeFs.cpSync(sourceAbsolutePath, destAbsolutePath, { recursive: true });
}

//ASync FS Wrapper functions

/**
 * @function readFile
 * @memberof module:fs
 * @description Asynchronously reads the entire contents of a file.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {Promise<string | Buffer>} A Promise that resolves with the contents of the file.
 * @throws {Error} If the file does not exist or is outside the secure scope.
 * @example
 * fs.readFile(fs.BOX, 'data/file.txt', 'utf8').then(contents => {
 *   console.log(contents);
 * });
 */
async function readFile(scope, filePath, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  return nodeFsPromises.readFile(absolutePath, options);
}

/**
 * @function writeFile
 * @memberof module:fs
 * @description Asynchronously writes data to a file, replacing the file if it already exists.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {string | Buffer} data - The data to write.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {Promise<void>} A Promise that resolves when the write operation is complete.
 * @throws {Error} If the file path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.writeFile(fs.BOX, 'data/file.txt', 'Hello, world!', 'utf8').then(() => {
 *   console.log('File written successfully');
 * });
 */
async function writeFile(scope, filePath, data, options) {
  const absolutePath = resolveSecurePath(scope, filePath);
  const dir = path.dirname(absolutePath);
  await nodeFsPromises.mkdir(dir, { recursive: true });
  return nodeFsPromises.writeFile(absolutePath, data, options);
}

/**
 * @function appendFile
 * @memberof module:fs
 * @description Asynchronously appends data to a file, creating directories as needed.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @param {string | Buffer} data - The data to append.
 * @param {object | string} [options] - The encoding or an options object.
 * @returns {Promise<void>} A Promise that resolves when the append operation is complete.
 * @throws {Error} If the file path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.appendFile(fs.BOX, 'data/file.txt', 'Hello, world!', 'utf8').then(() => {
 *   console.log('File appended successfully');
 * });
 */
async function appendFile(scope, filePath, data, options) {
  // 1. Get the secure, absolute path.
  const absolutePath = resolveSecurePath(scope, filePath);
  // 2. Ensure the directory exists before appending.
  const dir = path.dirname(absolutePath);
  await nodeFsPromises.mkdir(dir, { recursive: true });
  // 3. Call the real async fs.appendFile.
  return nodeFsPromises.appendFile(absolutePath, data, options);
}

/**
 * @function exists
 * @memberof module:fs
 * @description Asynchronously checks if a file exists.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @returns {Promise<boolean>} A Promise that resolves with true if the file exists, false otherwise.
 * @throws {Error} If the file path is outside the secure scope.
 * @example
 * fs.exists(fs.BOX, 'data/file.txt').then(exists => {
 *   console.log(exists);
 * });
 */
async function exists(scope, filePath) {
  const absolutePath = resolveSecurePath(scope, filePath);
  try {
    await nodeFsPromises.access(absolutePath);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * @function deleteFile
 * @memberof module:fs
 * @description Asynchronously deletes a file.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the file, relative to the scope or script.
 * @returns {Promise<void>} A Promise that resolves when the file is deleted.
 * @throws {Error} If the file does not exist or is outside the secure scope.
 * @example
 * fs.deleteFile(fs.BOX, 'data/file.txt').then(() => {
 *   console.log('File deleted successfully');
 * });
 */
async function deleteFile(scope, filePath) {
  const absolutePath = resolveSecurePath(scope, filePath);
  return nodeFsPromises.unlink(absolutePath);
}

/**
 * @function moveFile
 * @memberof module:fs
 * @description Asynchronously moves a file from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source file (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source file, relative to the source scope.
 * @param {string} destScope - The scope of the destination file (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination file, relative to the destination scope.
 * @returns {Promise<string>} A Promise that resolves with the new absolute path of the moved file.
 * @throws {Error} If the source and destination scopes are different.
 * @throws {Error} If the source file does not exist.
 * @example
 * fs.moveFile(fs.BOX, 'data/file.txt', fs.BOX, 'data/newfile.txt').then(newPath => {
 *   console.log('File moved to:', newPath);
 * });
 */
async function moveFile(sourceScope, sourcePath, destScope, destPath) {
  if (sourceScope !== destScope) {
    throw new Error("Security Error: rename/move operations must be within the same scope (BOX to BOX, or WEB to WEB).");
  }

  // Check if the source file exists
  if (!await exists(sourceScope, sourcePath)) {
    throw new Error(`Source file ${sourcePath} does not exist.`);
  }
  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  await nodeFsPromises.mkdir(path.dirname(destAbsolutePath), { recursive: true });
  return nodeFsPromises.rename(sourceAbsolutePath, destAbsolutePath);
}

/**
 * @function copyFile
 * @memberof module:fs
 * @description Asynchronously copies a file from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source file (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source file, relative to the source scope.
 * @param {string} destScope - The scope of the destination file (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination file, relative to the destination scope.
 * @return {Promise<void>} A Promise that resolves when the file is copied.
 * @throws {Error} if the source file does not exist.
 * @example
 * fs.copyFile(fs.BOX, 'data/file.txt', fs.BOX, 'data/copy.txt').then(() => {
 *   console.log('File copied successfully');
 * });
 */
async function copyFile(sourceScope, sourcePath, destScope, destPath) {
  // Check if the source file exists
  if (!await exists(sourceScope, sourcePath)) {
    throw new Error(`Source file ${sourcePath} does not exist.`);
  }

  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  await nodeFsPromises.mkdir(path.dirname(destAbsolutePath), { recursive: true });
  return nodeFsPromises.copyFile(sourceAbsolutePath, destAbsolutePath);
}

/**
 * @function mkdir
 * @memberof module:fs
 * @description Asynchronously creates a directory and its parent directories if they do not exist.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} dirPath - The path to the directory, relative to the scope or script.
 * @returns {Promise<void>} A Promise that resolves when the directory is created.
 * @throws {Error} If the directory path is outside the secure scope or if the directory cannot be created.
 * @example
 * fs.mkdir(fs.BOX, 'data/newdir').then(() => {
 *   console.log('Directory created successfully');
 * });
 */
async function mkdir(scope, dirPath) {
  const absolutePath = resolveSecurePath(scope, dirPath);
  return nodeFsPromises.mkdir(absolutePath, { recursive: true });
}

/**
 * @function rmdir
 * @memberof module:fs
 * @description Asynchronously removes a directory.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} dirPath - The path to the directory, relative to the scope or script.
 * @param {object} [options] - Options for the removal.
 *  - `recursive`: If true, removes the directory and its contents recursively.
 * @return {Promise<void>} A Promise that resolves when the directory is removed.
 * @throws {Error} If the directory does not exist or is outside the secure scope.
 * @example
 * fs.rmdir(fs.BOX, 'data/oldDir', { recursive: true }).then(() => {
 *   console.log('Directory removed successfully');
 * });
 */
async function rmdir(scope, dirPath, options = {}) {
  const absolutePath = resolveSecurePath(scope, dirPath);
  if (options.recursive) {
    return nodeFsPromises.rm(absolutePath, { recursive: true, force: true });
  }
  return nodeFsPromises.rmdir(absolutePath);
}

/**
 * @function moveDir
 * @memberof module:fs
 * @description Asynchronously moves a directory from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source directory (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source directory, relative to the source scope.
 * @param {string} destScope - The scope of the destination directory (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination directory, relative to the destination scope.
 * @returns {Promise<string>} A Promise that resolves with the new absolute path of the moved directory.
 * @throws {Error} if the source directory does not exist.
 * @example
 * fs.moveDir(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir').then(newPath => {
 *   console.log('Directory moved to:', newPath);
 * });
 * */
const moveDir = moveFile; // Alias for consistency with moveFile

/**
 * @function copyDir
 * @memberof module:fs
 * @description Asynchronously copies a directory from one location to another within the same scope.
 * @param {string} sourceScope - The scope of the source directory (fs.BOX or fs.WEB).
 * @param {string} sourcePath - The path to the source directory, relative to the source scope.
 * @param {string} destScope - The scope of the destination directory (fs.BOX or fs.WEB).
 * @param {string} destPath - The path to the destination directory, relative to the destination scope.
 * @returns {Promise<void>} A Promise that resolves when the directory is copied.
 * @throws {Error} if the source directory does not exist.
 * @example
 * fs.copyDir(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir').then(() => {
 *   console.log('Directory copied successfully');
 * });
 */
async function copyDir(sourceScope, sourcePath, destScope, destPath) {
  const sourceAbsolutePath = resolveSecurePath(sourceScope, sourcePath);
  const destAbsolutePath = resolveSecurePath(destScope, destPath);
  return nodeFsPromises.cp(sourceAbsolutePath, destAbsolutePath, { recursive: true });
}

module.exports = {
  /**
   * @constant BOX
   * @memberof module:fs
   * @description Constant for the BOX scope.
   * This constant can be used to specify the BOX scope when working with file system operations.
   * It represents the application box directory, typically used for sandboxed data and server scripts that should not be accessible from the web.
   */
  BOX: SCOPES.BOX,
  /**
   * @constant WEB
   * @memberof module:fs
   * @description Constant for the WEB scope.
   * This constant can be used to specify the WEB scope when working with file system operations.
   * It represents the web directory, typically used for web assets.
   */
  WEB: SCOPES.WEB,

  // Synchronous versions
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  deleteFileSync,
  copyFileSync,
  moveFileSync,
  mkdirSync,
  rmdirSync,
  moveDirSync,
  copyDirSync,

  // Asynchronous versions
  readFile,
  writeFile,
  appendFile,
  exists,
  deleteFile,
  copyFile,
  moveFile,
  mkdir,
  rmdir,
  moveDir,
  copyDir
};

