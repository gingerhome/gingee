const path = require('path');

// pdfmake 0.3.x exposes a module-level singleton API (not a constructable PdfPrinter class).
jest.mock('pdfmake', () => ({
    setUrlAccessPolicy: jest.fn(),
    setLocalAccessPolicy: jest.fn(),
    addFonts: jest.fn(),
    createPdf: jest.fn(),
}));

jest.mock('../../modules/internal_utils', () => {
    const actual = jest.requireActual('../../modules/internal_utils');
    return {
        ...actual,
        resolveSecurePath: jest.fn(),
    };
});

describe('pdf.js - PDF Generation (pdfmake 0.3 API)', () => {
    const mockPdfBytes = Buffer.from('%PDF-1.4 mock');
    let mockGetBuffer;
    let PdfPrinter;
    let internalUtils;
    let pdf;
    let als;
    let fs;

    beforeEach(() => {
        // jest.config has resetModules: true — re-require so pdf.js, ALS, and mocks share one graph.
        PdfPrinter = require('pdfmake');
        internalUtils = require('../../modules/internal_utils');
        ({ als } = require('../../modules/gingee'));
        fs = require('../../modules/fs');
        pdf = require('../../modules/pdf');
        mockGetBuffer = jest.fn().mockResolvedValue(mockPdfBytes);
        PdfPrinter.createPdf.mockImplementation(() => ({ getBuffer: mockGetBuffer }));
    });

    describe('init', () => {
        test('should configure access policies, register Roboto fonts, and return success', () => {
            const result = pdf.init();

            expect(result).toEqual({ status: true });
            expect(PdfPrinter.setUrlAccessPolicy).toHaveBeenCalledTimes(1);
            expect(PdfPrinter.setLocalAccessPolicy).toHaveBeenCalledTimes(1);
            expect(typeof PdfPrinter.setUrlAccessPolicy.mock.calls[0][0]).toBe('function');
            expect(typeof PdfPrinter.setLocalAccessPolicy.mock.calls[0][0]).toBe('function');

            expect(PdfPrinter.addFonts).toHaveBeenCalledTimes(1);
            const fontDescriptors = PdfPrinter.addFonts.mock.calls[0][0];
            expect(fontDescriptors).toHaveProperty('Roboto');
            expect(fontDescriptors.Roboto).toEqual({
                normal: expect.stringContaining(path.join('settings', 'fonts', 'Roboto', 'Roboto-Regular.ttf')),
                bold: expect.stringContaining(path.join('settings', 'fonts', 'Roboto', 'Roboto-Bold.ttf')),
                italics: expect.stringContaining(path.join('settings', 'fonts', 'Roboto', 'Roboto-Italic.ttf')),
                bolditalics: expect.stringContaining(path.join('settings', 'fonts', 'Roboto', 'Roboto-BoldItalic.ttf')),
            });
        });

        test('current URL and local access policies allow all (documented open defaults)', () => {
            pdf.init();
            const urlPolicy = PdfPrinter.setUrlAccessPolicy.mock.calls[0][0];
            const localPolicy = PdfPrinter.setLocalAccessPolicy.mock.calls[0][0];

            expect(urlPolicy('https://example.com/image.png')).toBe(true);
            expect(localPolicy('/any/host/path.ttf')).toBe(true);
        });
    });

    describe('create', () => {
        beforeEach(() => {
            pdf.init();
            // Re-apply after init used addFonts / policies so create assertions stay focused
            jest.clearAllMocks();
            mockGetBuffer = jest.fn().mockResolvedValue(mockPdfBytes);
            PdfPrinter.createPdf.mockImplementation(() => ({ getBuffer: mockGetBuffer }));
        });

        test('should use the default printer when no custom fonts are provided', async () => {
            const docDefinition = { content: 'Hello' };

            const result = await pdf.create(docDefinition);

            expect(PdfPrinter.createPdf).toHaveBeenCalledTimes(1);
            expect(PdfPrinter.createPdf).toHaveBeenCalledWith(docDefinition);
            expect(mockGetBuffer).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockPdfBytes);
            expect(PdfPrinter.addFonts).not.toHaveBeenCalled();
        });

        test('should resolve custom fonts via BOX scope and register them before createPdf', async () => {
            const mockApp = { name: 'testApp' };
            const mockStore = { app: mockApp, appName: 'testApp' };
            const docDefinition = {
                content: 'Hello with custom fonts',
                fonts: {
                    MyFont: {
                        normal: 'fonts/MyFont-Regular.ttf',
                        bold: 'fonts/MyFont-Bold.ttf',
                    },
                },
            };

            internalUtils.resolveSecurePath
                .mockReturnValueOnce('/abs/path/to/MyFont-Regular.ttf')
                .mockReturnValueOnce('/abs/path/to/MyFont-Bold.ttf');

            await als.run(mockStore, async () => {
                const result = await pdf.create(docDefinition);
                expect(result).toBe(mockPdfBytes);
            });

            expect(internalUtils.resolveSecurePath).toHaveBeenCalledWith(fs.BOX, 'fonts/MyFont-Regular.ttf');
            expect(internalUtils.resolveSecurePath).toHaveBeenCalledWith(fs.BOX, 'fonts/MyFont-Bold.ttf');
            expect(PdfPrinter.addFonts).toHaveBeenCalledWith({
                MyFont: {
                    normal: '/abs/path/to/MyFont-Regular.ttf',
                    bold: '/abs/path/to/MyFont-Bold.ttf',
                },
            });
            expect(PdfPrinter.createPdf).toHaveBeenCalledWith(docDefinition);
        });

        test('should resolve every style path for each custom font family', async () => {
            const mockStore = { app: { name: 'testApp' }, appName: 'testApp' };
            const docDefinition = {
                content: 'x',
                fonts: {
                    A: { normal: 'a.ttf', italics: 'a-i.ttf' },
                    B: { bold: 'b.ttf' },
                },
            };

            internalUtils.resolveSecurePath.mockImplementation((_scope, p) => `/resolved/${p}`);

            await als.run(mockStore, async () => {
                await pdf.create(docDefinition);
            });

            expect(internalUtils.resolveSecurePath).toHaveBeenCalledTimes(3);
            expect(PdfPrinter.addFonts).toHaveBeenCalledWith({
                A: { normal: '/resolved/a.ttf', italics: '/resolved/a-i.ttf' },
                B: { bold: '/resolved/b.ttf' },
            });
        });

        test('should surface errors from getBuffer', async () => {
            mockGetBuffer.mockRejectedValue(new Error('pdf render failed'));
            PdfPrinter.createPdf.mockImplementation(() => ({ getBuffer: mockGetBuffer }));

            await expect(pdf.create({ content: 'x' })).rejects.toThrow('pdf render failed');
        });
    });
});
