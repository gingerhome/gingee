const { render } = require('../../modules/chart');

// Mock the renderer
jest.mock('chartjs-node-canvas');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

describe('chart.js - Chart Rendering', () => {
    
    test('render should instantiate a renderer with correct dimensions and call its render method', async () => {
        const mockRenderToBuffer = jest.fn().mockResolvedValue(Buffer.from('chart_data'));
        ChartJSNodeCanvas.mockImplementation(function(options) {
            this.renderToBuffer = mockRenderToBuffer;
        });

        const chartConfig = { type: 'bar', data: {} };
        const renderOptions = { width: 1024, height: 768 };

        await render(chartConfig, renderOptions);

        // Verify it was instantiated with the correct dimensions
        expect(ChartJSNodeCanvas).toHaveBeenCalledWith({
            width: 1024,
            height: 768,
        });
        
        // Verify the render method was called with the chart config
        expect(mockRenderToBuffer).toHaveBeenCalledWith(chartConfig);
    });
});