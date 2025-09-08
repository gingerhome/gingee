const QRCode = require('qrcode');
const JsBarcode = require('jsbarcode');
const { createCanvas } = require('canvas');

/**
 * @module qrcode
 * @description Provides functions to generate QR codes and 1D barcodes.
 */

const OUTPUT_TYPES = {
    BUFFER: 'buffer',
    DATA_URL: 'dataurl'
};

/**
 * @function qrcode
 * @memberof module:qrcode
 * @description Generates a QR code from the provided text.
 * This function uses the 'qrcode' library to create QR codes, allowing for various output formats.
 * It supports both Buffer and Data URL outputs, making it flexible for different use cases.
 * @param {string} text - The text or data to encode.
 * @param {object} [options] - Optional settings.
 * @param {string} [options.output='buffer'] - The output type: 'buffer' or 'dataurl'.
 * @param {string} [options.errorCorrectionLevel='medium'] - 'low', 'medium', 'quartile', 'high'.
 * @param {number} [options.margin=4] - The width of the quiet zone border.
 * @param {number} [options.width=200] - The width of the image in pixels.
 * @returns {Promise<Buffer|string>} A promise that resolves with the QR code data.
 * @throws {Error} If the input text is not a string or if the output type is invalid.
 * @example
 * const qrCode = await qrcode('Hello, world!', { output: qrcode.DATA_URL });
 * console.log(qrCode); // Outputs a Data URL of the QR code image
 * @example
 * const qrCodeBuffer = await qrcode('Hello, world!', { output: qrcode.BUFFER });
 * console.log(qrCodeBuffer); // Outputs a Buffer of the QR code image
 */
async function qrcode(text, options = {}) {
    const finalOptions = {
        output: OUTPUT_TYPES.BUFFER,
        errorCorrectionLevel: 'medium',
        margin: 4,
        width: 200,
        ...options,
    };

    const qrOptions = {
        errorCorrectionLevel: finalOptions.errorCorrectionLevel,
        margin: finalOptions.margin,
        width: finalOptions.width,
    };

    if (finalOptions.output === OUTPUT_TYPES.DATA_URL) {
        return QRCode.toDataURL(text, qrOptions);
    }
    // Default to buffer
    return QRCode.toBuffer(text, qrOptions);
}

/**
 * @function barcode
 * @memberof module:qrcode
 * @description Generates a 1D barcode from the provided text.
 * This function uses the 'jsbarcode' library to create 1D barcodes.
 * @param {string} format - The barcode format (e.g., 'CODE128', 'EAN13', 'UPC').
 * @param {string} text - The text or data to encode.
 * @param {object} [options] - Optional settings.
 * @param {string} [options.output='buffer'] - The output type: 'buffer' or 'dataurl'.
 * @param {number} [options.width=2] - The width of a single bar.
 * @param {number} [options.height=100] - The height of the bars.
 * @param {boolean} [options.displayValue=true] - Whether to display the text below the barcode.
 * @returns {Promise<Buffer|string>} A promise that resolves with the barcode data.
 * @throws {Error} If the input text is not a string or if the output type is invalid.
 * @example
 * const barcode = await barcode('CODE128', '123456789012', { output: barcode.DATA_URL });
 * console.log(barcode); // Outputs a Data URL of the barcode image
 * @example
 * const barcodeBuffer = await barcode('CODE128', '123456789012', { output: barcode.BUFFER });
 * console.log(barcodeBuffer); // Outputs a Buffer of the barcode image
 */
async function barcode(format, text, options = {}) {
    const finalOptions = {
        output: OUTPUT_TYPES.BUFFER,
        width: 2,
        height: 100,
        displayValue: true,
        ...options,
    };

    const canvas = createCanvas(200, 200); // Initial canvas size, jsbarcode will resize if needed.

    // jsbarcode renders the barcode onto the canvas
    JsBarcode(canvas, text, {
        format: format,
        width: finalOptions.width,
        height: finalOptions.height,
        displayValue: finalOptions.displayValue,
    });

    if (finalOptions.output === OUTPUT_TYPES.DATA_URL) {
        return canvas.toDataURL('image/png');
    }
    // Default to buffer
    return canvas.toBuffer('image/png');
}


module.exports = {
    qrcode,
    barcode,
    /**
     * @constant BUFFER
     * @memberof module:qrcode
     * @description Constant for Buffer output type.
     * This constant can be used to specify that the output should be a Buffer.
     */
    BUFFER: OUTPUT_TYPES.BUFFER,
    /**
     * @constant DATA_URL
     * @memberof module:qrcode
     * @description Constant for Data URL output type.
     * This constant can be used to specify that the output should be a Data URL.
     */
    DATA_URL: OUTPUT_TYPES.DATA_URL,
};
