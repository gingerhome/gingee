const { als } = require('../../modules/gingee');
const pdf = require('../../modules/pdf');

// Mock the dependencies of the pdf module
const mockCreatePdfKitDocument = jest.fn(() => ({
    on: jest.fn((event, cb) => {
        if (event === 'end') cb(); // Automatically trigger 'end' for the promise to resolve
    }),
    end: jest.fn(),
}));

const mockPdfPrinterInstance = {
    createPdfKitDocument: mockCreatePdfKitDocument,
};

jest.mock('pdfmake', () => {
    // This is a manual mock that simulates the class structure.
    return jest.fn().mockImplementation(() => {
        return mockPdfPrinterInstance;
    });
});
jest.mock('../../modules/internal_utils'); 

const PdfPrinter = require('pdfmake');
const internalUtils = require('../../modules/internal_utils');

describe('pdf.js - PDF Generation', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('create should use the default printer when no custom fonts are provided', async () => {
        const docDefinition = { content: 'Hello' };
        
        // pdf.init() creates the default printer instance using our mock constructor
        pdf.init(); 
        await pdf.create(docDefinition);

        // Verify that the default printer's method was called.
        expect(mockCreatePdfKitDocument).toHaveBeenCalledWith(docDefinition);
    });

    test('create should create a new, temporary printer for custom fonts', async () => {
        internalUtils.resolveSecurePath.mockReturnValue('/fake/path/to/font.ttf');

        const docDefinition = {
            fonts: { MyFont: { normal: './fonts/myfont.ttf' } },
            content: 'Hello'
        };
        
        const mockStore = {
            app: { appBoxPath: '/fake/app/box' }
        };

        await als.run(mockStore, async () => {
            await pdf.create(docDefinition);
        });

        // Verify that a NEW PdfPrinter was instantiated with the custom font path
        // This will be the second call, the first being in pdf.init()
        expect(PdfPrinter).toHaveBeenCalledWith({
            MyFont: { normal: '/fake/path/to/font.ttf' }
        });
        
        // Verify its create method was also called
        expect(mockCreatePdfKitDocument).toHaveBeenCalledWith(docDefinition);
    });
});
