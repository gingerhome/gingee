const PdfPrinter = require('pdfmake');
const path = require('path');
const fs = require('./fs.js');
const { getContext } = require('./gingee.js');
const { resolveSecurePath } = require('./internal_utils.js');

/**
 * @module pdf
 * @description
 * This module provides functionality to create PDF documents using pdfmake.
 * It includes a default font configuration with Roboto and a function to create PDFs from document definitions.
 * It is designed to be used in a secure environment, ensuring that only allowed fonts are registered.
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

let defaultPrinter;

/**
 * Initializes the PDF module with default fonts.
 * Called once by gingee.js at server startup.
 * @private
 */
function init() {
    try {
        const engineRoot = path.dirname(__dirname);
        const fontDescriptors = {
            Roboto: {
                normal: path.join(engineRoot, 'settings/fonts/Roboto/Roboto-Regular.ttf'),
                bold: path.join(engineRoot, 'settings/fonts/Roboto/Roboto-Bold.ttf'),
                italics: path.join(engineRoot, 'settings/fonts/Roboto/Roboto-Italic.ttf'),
                bolditalics: path.join(engineRoot, 'settings/fonts/Roboto/Roboto-BoldItalic.ttf')
            }
        };
        defaultPrinter = new PdfPrinter(fontDescriptors);
        return { status: true };
    } catch (error) {
        return { status: false, error };
    }
}

/**
 * @function create
 * @memberOf module:pdf
 * @description Creates a PDF document from a document definition object.
 * @param {object} documentDefinition - A standard pdfmake document definition object.
 * @returns {Promise<Buffer>} A promise that resolves with the PDF data as a Buffer.
 * @throws {Error} If there is an issue creating the PDF document.
 * @example
 * const pdf = require('pdf');
 * const docDefinition = {
 *     pageSize: 'LETTER',
 *     pageMargins: [40, 60, 40, 60],
 *     header: { text: 'Gingee Weekly Report', alignment: 'center', margin: [0, 20, 0, 0] },
 *     content: [
 *         { text: 'Hello, World!', fontSize: 15 }
 *     ]
 * };
 * const pdfBuffer = await pdf.create(docDefinition);
 * const fileName = `report-${Date.now()}.pdf`;
 * $g.response.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
 * $g.response.send(pdfBuffer, 200, 'application/pdf');
 */
function create(documentDefinition) {
    let printerToUse = defaultPrinter;

    if (documentDefinition.fonts) {
        const { app } = getContext();
        const customFontDescriptors = {};

        // Process each font family defined by the developer
        for (const fontFamily in documentDefinition.fonts) {
            const fontStyles = documentDefinition.fonts[fontFamily];
            customFontDescriptors[fontFamily] = {};
            // Process each style (normal, bold, etc.)
            for (const style in fontStyles) {
                const fontPath = fontStyles[style];
                // Securely resolve the font path from within the app's BOX scope.
                const absolutePath = resolveSecurePath(fs.BOX, fontPath);
                customFontDescriptors[fontFamily][style] = absolutePath;
            }
        }

        // Create a temporary, request-specific printer with the custom fonts.
        printerToUse = new PdfPrinter(customFontDescriptors);
    }

    return new Promise((resolve, reject) => {
        try {
            // Create the PDF document
            const pdfDoc = printerToUse.createPdfKitDocument(documentDefinition);

            const chunks = [];
            pdfDoc.on('data', (chunk) => {
                chunks.push(chunk);
            });

            pdfDoc.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            pdfDoc.end();

        } catch (err) {
            reject(err);
        }
    });
}

// In the future, you could add a registerFont function here if needed,
// but bundling a default like Roboto is a great start.

module.exports = {
    init,
    create
};
