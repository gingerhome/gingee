const path = require('path');
const { als } = require('../../modules/gingee');

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

const PdfPrinter = require('pdfmake');
const internalUtils = require('../../modules/internal_utils');
const pdf = require('../../modules/pdf');
const fs = require('../../modules/fs');

describe('pdf.js - PDF Generation (pdfmake 0.3 API)', () => {
    const mockPdfBytes = Buffer.from('%PDF-1.4 mock');
    let mockGetBuffer;

    beforeEach(() => {
        jest.clearAllMocks();
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
            // No custom font registration on the default path
            expect(PdfPrinter.addFonts).not.toHaveBeenCalled();
        });

        test('should resolve custom fonts via BOX scope and register them before createPdf', async () => {
            internalUtils.resolveSecurePath.mockReturnValue('/fake/app/box/fonts/myfont.ttf');

            const docDefinition = {
                fonts: { MyFont: { normal: './fonts/myfont.ttf' } },
                content: 'Hello with custom font',
            };

            const mockStore = {
                appName: 'test_app',
                app: {
                    name: 'test_app',
                    appBoxPath: path.resolve('/fake/app/box'),
                    appWebPath: path.resolve('/fake/app'),
                },
                scriptFolder: path.resolve('/fake/app/box'),
            };

            let result;
            await als.run(mockStore, async () => {
                result = await pdf.create(docDefinition);
            });

            expect(internalUtils.resolveSecurePath).toHaveBeenCalledWith(fs.BOX, './fonts/myfont.ttf');
            expect(PdfPrinter.addFonts).toHaveBeenCalledWith({
                MyFont: { normal: '/fake/app/box/fonts/myfont.ttf' },
            });
            expect(PdfPrinter.createPdf).toHaveBeenCalledWith(docDefinition);
            expect(mockGetBuffer).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockPdfBytes);
        });

        test('should resolve every style path for each custom font family', async () => {
            internalUtils.resolveSecurePath
                .mockReturnValueOnce('/box/fonts/a-regular.ttf')
                .mockReturnValueOnce('/box/fonts/a-bold.ttf')
                .mockReturnValueOnce('/box/fonts/b-regular.ttf');

            const docDefinition = {
                fonts: {
                    FontA: {
                        normal: './fonts/a-regular.ttf',
                        bold: './fonts/a-bold.ttf',
                    },
                    FontB: {
                        normal: './fonts/b-regular.ttf',
                    },
                },
                content: 'multi-font',
            };

            await als.run({
                appName: 'test_app',
                app: { name: 'test_app', appBoxPath: '/box', appWebPath: '/' },
                scriptFolder: '/box',
            }, async () => {
                await pdf.create(docDefinition);
            });

            expect(internalUtils.resolveSecurePath).toHaveBeenCalledTimes(3);
            expect(PdfPrinter.addFonts).toHaveBeenCalledWith({
                FontA: {
                    normal: '/box/fonts/a-regular.ttf',
                    bold: '/box/fonts/a-bold.ttf',
                },
                FontB: {
                    normal: '/box/fonts/b-regular.ttf',
                },
            });
        });

        test('should surface errors from getBuffer', async () => {
            mockGetBuffer.mockRejectedValueOnce(new Error('render failed'));

            await expect(pdf.create({ content: 'x' })).rejects.toThrow('render failed');
        });
    });
});
