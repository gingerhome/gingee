const fs = require('./fs.js'); // Our secure fs module for font registration
const { loadOptional } = require('./internal_utils.js');

/**
 * @module chart
 * @description
 * This module provides functionality to create and manipulate charts using Chart.js.
 * It includes a renderer for generating chart images and a font registration system.
 *
 * <b>Optional dependency:</b> requires <code>chartjs-node-canvas</code> and <code>canvas</code>
 * (package.json optionalDependencies). Install without <code>--omit=optional</code>, or
 * <code>npm install chartjs-node-canvas canvas</code>.
 */

const OUTPUT_TYPES = {
    BUFFER: 'buffer',
    DATA_URL: 'dataurl'
};

/** @type {Function|null} */
let ChartJSNodeCanvas = null;

/** @type {object|null} */
let defaultRenderer = null;

/**
 * @private
 */
function loadChartCanvas() {
    // Always resolve via require so the same module identity as test mocks is used,
    // but only throw FEATURE_NOT_INSTALLED when the package is truly missing.
    if (!ChartJSNodeCanvas) {
        const mod = loadOptional(
            () => require('chartjs-node-canvas'),
            'chartjs-node-canvas',
            'Chart rendering (chart module)'
        );
        ChartJSNodeCanvas = mod.ChartJSNodeCanvas || mod;
        loadOptional(() => require('canvas'), 'canvas', 'Chart rendering (node-canvas)');
    }
    return ChartJSNodeCanvas;
}

/**
 * Shared renderer for font registration (matches prior module behavior).
 * @private
 */
function getDefaultRenderer() {
    const ChartCtor = loadChartCanvas();
    if (!defaultRenderer) {
        defaultRenderer = new ChartCtor({
            width: 800,
            height: 600
        });
    }
    return defaultRenderer;
}

/**
 * @function render
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
    const ChartCtor = loadChartCanvas();
    const finalOptions = {
        width: 800,
        height: 600,
        output: OUTPUT_TYPES.BUFFER,
        ...options
    };

    const renderer = new ChartCtor({
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
    getDefaultRenderer().registerFont(absolutePath, { family: options.family });
}

module.exports = {
    render,
    registerFont,
    BUFFER: OUTPUT_TYPES.BUFFER,
    DATA_URL: OUTPUT_TYPES.DATA_URL,
};
