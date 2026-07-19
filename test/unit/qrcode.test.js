// Mock the underlying libraries
jest.mock('qrcode');
jest.mock('jsbarcode');
jest.mock('canvas');

describe('qrcode.js - Code Generation', () => {
    let qrcode;
    let barcode;
    let QRCode;
    let JsBarcode;
    let createCanvas;

    beforeEach(() => {
        QRCode = require('qrcode');
        JsBarcode = require('jsbarcode');
        ({ createCanvas } = require('canvas'));
        ({ qrcode, barcode } = require('../../modules/qrcode'));
        jest.clearAllMocks();
    });

    test('qrcode should call the qrcode library with correct options', async () => {
        await qrcode('test-data', { output: 'dataurl', margin: 10 });

        expect(QRCode.toDataURL).toHaveBeenCalledWith('test-data', {
            errorCorrectionLevel: 'medium',
            margin: 10,
            width: 200
        });
    });

    test('barcode should call the jsbarcode library with correct options', async () => {
        const mockCanvas = { toBuffer: jest.fn(), toDataURL: jest.fn() };
        createCanvas.mockReturnValue(mockCanvas);

        await barcode('CODE128', '12345', { displayValue: false });

        expect(JsBarcode).toHaveBeenCalledWith(mockCanvas, '12345', {
            format: 'CODE128',
            width: 2,
            height: 100,
            displayValue: false,
        });

        expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/png');
    });
});
