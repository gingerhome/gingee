const dashboard = require('../../modules/dashboard');
const chart = require('../../modules/chart'); 
const fs = require('fs');  

const { loadImage } = require('canvas');

describe('dashboard.js - Dashboard Composition', () => {
    
    test('init should correctly calculate cell geometry', () => {
        const layout = {
            width: 1040, height: 840,
            grid: { rows: 2, cols: 2, padding: 20 },
            cells: {
                "cellA": { row: 0, col: 0 },
                "cellB": { row: 0, col: 1, rowspan: 2 }
            }
        };
        // Cell width = (1040 - 3*20) / 2 = 980 / 2 = 490
        // Cell height = (840 - 3*20) / 2 = 780 / 2 = 390
        
        const db = dashboard.init(layout);
        
        expect(db.cells['cellA'].x).toBe(20);
        expect(db.cells['cellA'].y).toBe(20);
        expect(db.cells['cellA'].width).toBe(490);
        expect(db.cells['cellA'].height).toBe(390);

        expect(db.cells['cellB'].height).toBe((2 * 390) + 20); // 2 cells + 1 padding
    });

    test('renderChart should call the chart module with the correct cell dimensions', async () => {
        jest.mock('../../modules/chart');
        chart.render = jest.fn().mockResolvedValue(Buffer.from(fs.readFileSync('test/data/chart.png')));
        const layout = {
            width: 500, height: 500, grid: { rows: 1, cols: 1, padding: 0 },
            cells: { "main": { row: 0, col: 0 } }
        };
        const chartConfig = { type: 'bar', data: {} };
        
        const myDashboard = dashboard.init(layout);
        await myDashboard.renderChart('main', chartConfig);

        // Verify that chart.render was called, and that the options
        // passed to it have the width and height from the cell.
        expect(chart.render).toHaveBeenCalledWith(chartConfig, {
            width: 500,
            height: 500,
            output: chart.BUFFER
        });
    });
});
