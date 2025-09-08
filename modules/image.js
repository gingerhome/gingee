const sharp = require('sharp');
const fs = require('./fs.js'); // Our secure fs module

/**
 * @module image
 * @description A module for image processing using the [Sharp]{@link https://sharp.pixelplumbing.com/} library.
 * It provides a simple and secure way to manipulate images, including resizing, rotating, flipping, and more.
 * <b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

/**
 * A secure wrapper class for the  [Sharp]{@link https://sharp.pixelplumbing.com/} image processing library.
 * Each method returns 'this' to allow for a fluent, chainable API. This class cannot be directly instantiated.
 * Instead, use the `load` function of the Image module to create an instance with an image loaded from a Buffer or a file path.
 * This class abstracts the complexities of image processing, providing a simple interface for developers to work with images.
 * It allows for flexible image manipulation workflows, enabling developers to chain multiple operations on the image.
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */
class ImageProcessor {
    /**
     * Creates a new ImageProcessor instance.
     * @param sharpInstance - An instance of the sharp image processing library.
     * 
     */
    constructor(sharpInstance) {
        this._image = sharpInstance;
    }

    // --- MANIPULATION ---

    /**
     * @description Resizes the image to the specified dimensions.
     * @param {object} options - The resize options.
     * @param {number} options.width - The new width of the image.
     * @param {number} options.height - The new height of the image.
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.resize({ width: 200, height: 200, fit: 'contain', background: '#FFFFFF' });
     */
    resize(options) {
        this._image.resize(options);
        return this;
    }

    /**
     * @description Rotates the image by the specified angle.
     * @param {number} angle - The angle to rotate the image (in degrees).
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.rotate(90);
     */
    rotate(angle = 0) {
        this._image.rotate(angle);
        return this;
    }

    /**
     * @description Flips the image horizontally.
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.flip();
     */
    flip() {
        this._image.flip();
        return this;
    }

    /**
     * @description Flips the image vertically.
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.flop();
     */
    flop() {
        this._image.flop();
        return this;
    }

    // --- FILTERS ---

    /**
     * @description Converts the image to greyscale.
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.greyscale();
     */
    greyscale() {
        this._image.greyscale();
        return this;
    }

    /**
     * @description Applies a blur effect to the image.
     * @param {number} sigma - The blur amount (higher values = more blur).
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.blur(5);
     */
    blur(sigma) {
        this._image.blur(sigma);
        return this;
    }

    /**
     * @description Sharpens the image.
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.sharpen();
     */
    sharpen() {
        this._image.sharpen();
        return this;
    }

    // --- COMPOSITION ---

    /**
     * @description Composites another image onto this one.
     * @param {Buffer} watermarkBuffer - The image buffer to composite.
     * @param {object} options - The options for compositing.
     *  @param {number} [options.left=0] - The x-coordinate to place the watermark.
     *  @param {number} [options.top=0] - The y-coordinate to place the watermark.
     *  @param {number} [options.opacity=1] - The opacity of the watermark
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.composite(watermarkBuffer, { left: 10, top: 10, opacity: 0.5 });
     */
    composite(watermarkBuffer, options) {
        if (!Buffer.isBuffer(watermarkBuffer)) {
            throw new Error("Watermark must be a Buffer.");
        }
        this._image.composite([{ input: watermarkBuffer, ...options }]);
        return this;
    }

    // --- FORMATTING ---

    /**
     * @description Converts the image to a specific format.
     * @param {string} format - The format to convert to (e.g., 'jpeg', 'png', 'webp').
     * @param {object} [options] - Options for the format conversion (see sharp documentation).
     * @returns {ImageProcessor} The ImageProcessor instance for chaining.
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.format('jpeg', { quality: 80 });
     */
    format(format, options) {
        // Sharp's format function is also its toFormat conversion.
        this._image.toFormat(format, options);
        return this;
    }

    // --- OUTPUT (TERMINAL) METHODS ---

    /**
     * @description Processes the image and returns the final data as a Buffer.
     * @returns {Promise<Buffer>}
     * @example
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.resize({ width: 200, height: 200 });
     * const buffer = await processor.toBuffer();
     */
    async toBuffer() {
        return this._image.toBuffer();
    }

    /**
     * @description Processes the image and saves it to a file using our secure fs module.
     * @param {string} scope - The scope to save to (fs.BOX or fs.WEB).
     * @param {string} filePath - The destination file path.
     * @returns {Promise<void>}
     * @example
     * // path with leading slash indicates path from scope root, 
     * // path without leading slash indicates path relative to the executing script
     * // here image is loaded from <project>/<app_name>/<box>/images/ginger.png
     * // image is and saved to <project>/<app_name>/output/processed_image.webp
     * const processor = image.load(fs.BOX, '/images/ginger.png');
     * processor.resize({ width: 200, height: 200 });
     * await processor.toFile(fs.WEB, '/output/processed_image.webp');
     */
    async toFile(scope, filePath) {
        const buffer = await this.toBuffer();
        // Use our secure, sandboxed fs.writeFile to save the file.
        await fs.writeFile(scope, filePath, buffer);
    }
}


/**
 * @function loadFromFile
 * @memberof module:image
 * @description Loads an image from a Buffer or a file path.
 * This function initializes an ImageProcessor instance with the provided image data.
 * It supports both Buffer inputs (for in-memory images) and file paths (for images stored on disk).
 * It abstracts the complexities of loading images, providing a simple interface for developers to work with images.
 * It allows for flexible image processing workflows, enabling developers to chain multiple operations on the image.
 * @param {string} filePath - a file path to an image file.
 * @returns {ImageProcessor} A new instance of our ImageProcessor for chaining operations.
 * @example
 * const image = require('image');
 * const processor = image.load(fs.BOX, './images/ginger.png');
 * processor.resize({ width: 200, height: 200 }).greyscale().toFile(fs.WEB, 'output/processed_image.webp');
 * @throws {Error} If the input is not a Buffer or a valid file path.
 */
function loadFromFile(scope, filePath, options = {}) {
    if (scope && ![fs.BOX, fs.WEB].includes(scope)) {
        throw new Error("Invalid scope provided. Use fs.BOX or fs.WEB.");
    }
    const imageBuffer = fs.readFileSync(scope || fs.BOX, filePath, options);
    let sharpInstance = sharp(imageBuffer);

    return new ImageProcessor(sharpInstance);
}

/**
 * @function loadFromBuffer
 * @memberof module:image
 * @description Loads an image from a Buffer.
 * This function initializes an ImageProcessor instance with the provided image data.
 * @param {Buffer} buffer - A Buffer containing image data.
 * @returns {ImageProcessor} A new instance of our ImageProcessor for chaining operations.
 * @example
 * const image = require('image');
 * const processor = image.loadFromBuffer(buffer);
 * processor.resize({ width: 200, height: 200 }).greyscale().toFile(fs.WEB, 'output/processed_image.webp');
 * @throws {Error} If the input is not a Buffer.
 */
function loadFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error("Invalid input: loadFromBuffer requires a Buffer.");
    }
    const sharpInstance = sharp(buffer);
    return new ImageProcessor(sharpInstance);
}

module.exports = {
    loadFromFile,
    loadFromBuffer
};
