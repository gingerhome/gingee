const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('./fs.js'); // Our secure fs module for font registration

/**
 * @module chart
 * @description
 * This module provides functionality to create and manipulate charts using Chart.js.
 * It includes a renderer for generating chart images and a font registration system.
 */

const OUTPUT_TYPES = {
    BUFFER: 'buffer',
    DATA_URL: 'dataurl'
};

// We create one instance of the renderer and reuse it.
// This is more efficient than creating a new one for every request.
const canvasRenderer = new ChartJSNodeCanvas({
    width: 800, // Default width
    height: 600, // Default height
    chartCallback: (ChartJS) => {
        // Allows for global Chart.js configuration if needed
        // For example: ChartJS.defaults.font.family = 'Arial';
    }
});

/**
 * @function runInGBox
 * @memberOf module:chart
 * @description Renders a chart based on a Chart.js configuration object.
 * @param {object} configuration - A standard Chart.js configuration object (type, data, options).
 * @param {object} [options] - Optional settings for the output.
 * @param {number} [options.width=800] - The width of the final image in pixels.
 * @param {number} [options.height=600] - The height of the final image in pixels.
 * @param {string} [options.output='buffer'] - The output type: 'buffer' or 'dataurl'.
 * @returns {Promise<Buffer|string>} A promise that resolves with the chart image data.
 * @throws {Error} If the configuration is invalid or rendering fails.
 * @example
 * const chart = require('chart');
 * const config = {
 *     type: 'bar',
 *     data: {
 *         labels: ['January', 'February', 'March'],
 *         datasets: [{
 *             label: 'Sales',
 *             data: [100, 200, 300]
 *         }]
 *     }
 * };
 * const imageBuffer = await chart.render(config);
 * // To send the image in a http response:
 * $g.response.send(imageBuffer, 200, 'image/png');
 */
async function render(configuration, options = {}) {
    const finalOptions = {
        width: 800,
        height: 600,
        output: OUTPUT_TYPES.BUFFER,
        ...options
    };

    const renderer = new ChartJSNodeCanvas({
        width: finalOptions.width,
        height: finalOptions.height,
    });

    if (finalOptions.output === OUTPUT_TYPES.DATA_URL) {
        return renderer.renderToDataURL(configuration);
    }

    // Default to buffer
    return renderer.renderToBuffer(configuration);
}

/**
 * @function registerFont
 * @memberOf module:chart
 * @description Registers a custom font from a file to be used in charts.
 * This should be called at the application's startup or in a default_include script.
 * @param {string} scope - The scope where the font file is located (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the .ttf or .otf font file.
 * @param {object} options - Font registration options.
 * @param {string} options.family - The font-family name to use in Chart.js configs (e.g., 'Roboto').
 * @throws {Error} If the font file cannot be found or registered.
 * @example
 * chart.registerFont(fs.BOX, 'path/to/Roboto-Regular.ttf', { family: 'Roboto' });
 */
function registerFont(scope, filePath, options) {
    const absolutePath = fs.resolveSecurePath(scope, filePath);
    canvasRenderer.registerFont(absolutePath, { family: options.family });
}

module.exports = {
    render,
    registerFont,
    // Export constants for user convenience
    /*
    * @constant BUFFER
    * @description
    * This constant represents the output type for rendering charts as a buffer.
    */
    BUFFER: OUTPUT_TYPES.BUFFER,
    /**
     * @constant DATA_URL
     * @description
     * This constant represents the output type for rendering charts as a Data URL.
     */
    DATA_URL: OUTPUT_TYPES.DATA_URL,
};
