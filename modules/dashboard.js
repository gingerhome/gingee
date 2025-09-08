const { createCanvas, loadImage } = require('canvas');
const chart = require('./chart.js'); // We will use this in the next step

/**
 * @module dashboard
 * @description
 * This module provides functionality to create and manage a dashboard layout with multiple charts.
 * It allows for rendering charts into specific cells of a defined grid layout.
 * The dashboard can be initialized with a JSON layout object, and charts can be rendered into specified cells.
 * The final dashboard image can be exported as a PNG buffer or Data URL.
 */

/**
 * The Dashboard class manages the layout, canvas, and rendering of multiple charts.
 * This class is returned by the init() function.
 * It provides methods to render charts into specific cells and export the final dashboard image.
 */
class Dashboard {
    /**
     * Initializes the Dashboard instance with a layout object.
     * The layout should define the grid structure and cell definitions.
     * @param {object} layout - The JSON object defining the dashboard layout.
     * @throws {Error} If the layout is invalid or missing required properties.
     */
    constructor(layout) {
        if (!layout || !layout.width || !layout.height || !layout.grid) {
            throw new Error("Invalid layout: 'width', 'height', and 'grid' are required.");
        }

        this.layout = layout;
        this.canvas = createCanvas(layout.width, layout.height);
        this.ctx = this.canvas.getContext('2d');
        this.cells = this._calculateCellGeometry();

        // Set a background color for the entire dashboard
        this.ctx.fillStyle = layout.backgroundColor || '#FFFFFF';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Calculates the pixel dimensions and coordinates for each named cell in the layout.
     * @private
     */
    _calculateCellGeometry() {
        const { grid, cells } = this.layout;
        const cellWidth = (this.layout.width - (grid.padding * (grid.cols + 1))) / grid.cols;
        const cellHeight = (this.layout.height - (grid.padding * (grid.rows + 1))) / grid.rows;

        const geometry = {};

        for (const cellName in cells) {
            const cellDef = cells[cellName];
            const colspan = cellDef.colspan || 1;
            const rowspan = cellDef.rowspan || 1;

            const x = (cellDef.col * cellWidth) + ((cellDef.col + 1) * grid.padding);
            const y = (cellDef.row * cellHeight) + ((cellDef.row + 1) * grid.padding);

            const width = (colspan * cellWidth) + ((colspan - 1) * grid.padding);
            const height = (rowspan * cellHeight) + ((rowspan - 1) * grid.padding);

            geometry[cellName] = { x, y, width, height };
        }

        return geometry;
    }

    /**
   * Renders a chart into a specified cell of the dashboard.
   * @param {string} cellName - The name of the cell (defined in the layout) to render into.
   * @param {object} chartConfig - A standard Chart.js configuration object.
   * @returns {Promise<Dashboard>} A promise that resolves with the Dashboard instance for chaining.
   */
    async renderChart(cellName, chartConfig) {
        const cell = this.cells[cellName];
        if (!cell) {
            throw new Error(`Dashboard cell '${cellName}' is not defined in the layout.`);
        }

        // 1. Render the chart to a buffer using our chart module.
        //    We force the width and height to match the cell's dimensions.
        const chartBuffer = await chart.render(chartConfig, {
            width: cell.width,
            height: cell.height,
            output: chart.BUFFER
        });

        // 2. Load the rendered chart buffer into a Canvas Image object.
        const chartImage = await loadImage(chartBuffer);

        // 3. Draw the chart image onto our main dashboard canvas at the cell's coordinates.
        this.ctx.drawImage(chartImage, cell.x, cell.y, cell.width, cell.height);

        // 4. Return 'this' to allow for chaining.
        return this;
    }

    /**
     * Returns the final dashboard image as a PNG buffer.
     * @returns {Buffer}
     */
    toBuffer() {
        return this.canvas.toBuffer('image/png');
    }

    /**
     * Returns the final dashboard image as a Data URL.
     * @returns {string}
     */
    toDataURL() {
        return this.canvas.toDataURL();
    }
}


/**
 * @function init
 * @memberOf module:dashboard
 * @description Initializes a new dashboard layout.
 * @param {object} layout - The JSON object defining the dashboard layout.
 * @returns {Dashboard} An instance of the Dashboard class, ready for rendering.
 * @example
 * const dashboardLayout = {
 *     width: 1200,
 *     height: 800,
 *     backgroundColor: '#F5F5F5',
 *     grid: { rows: 2, cols: 2, padding: 20 },
 *     cells: {
 *         "bar-chart": { "row": 0, "col": 0, "colspan": 2 },
 *         "pie-chart": { "row": 1, "col": 0 },
 *         "line-chart": { "row": 1, "col": 1 }
 *     }
 * };
 * const myDashboard = dashboard.init(dashboardLayout);
 * // Now you can render charts into the dashboard:
 * const finalImageBuffer = myDashboard.toBuffer();
 * // To send the image in a http response:
 * $g.response.send(finalImageBuffer, 200, 'image/png');
 */
function init(layout) {
    return new Dashboard(layout);
}

module.exports = {
    init
};
