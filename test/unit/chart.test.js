// Mock optional media stack
jest.mock('chartjs-node-canvas');
jest.mock('canvas', () => ({ createCanvas: jest.fn(), loadImage: jest.fn() }));

describe('chart.js - Chart Rendering', () => {
    test('render should instantiate a renderer with correct dimensions and call its render method', async () => {
        // resetModules (jest.config) — re-require so chart and mock share one constructor
        const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
        const { render } = require('../../modules/chart');

        const mockRenderToBuffer = jest.fn().mockResolvedValue(Buffer.from('chart_data'));
        ChartJSNodeCanvas.mockImplementation(function (options) {
            this.renderToBuffer = mockRenderToBuffer;
            this.renderToDataURL = jest.fn();
            this.registerFont = jest.fn();
        });

        const chartConfig = { type: 'bar', data: {} };
        const renderOptions = { width: 1024, height: 768 };

        await render(chartConfig, renderOptions);

        expect(ChartJSNodeCanvas).toHaveBeenCalledWith({
            width: 1024,
            height: 768,
        });
        expect(mockRenderToBuffer).toHaveBeenCalledWith(chartConfig);
    });
});
