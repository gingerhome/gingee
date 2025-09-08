const archiver = require('archiver');
const extract = require('extract-zip');
const { als } = require('../../modules/ginger');
const fs = require('../../modules/fs'); // The secure fs wrapper
const nodeFs = require('fs'); // The native fs
const zip = require('../../modules/zip');
const { resolveSecurePath } = require('../../modules/internal_utils');

// Mock the libraries and modules
jest.mock('archiver');
jest.mock('extract-zip');
jest.mock('../../modules/fs');
jest.mock('fs');
jest.mock('../../modules/internal_utils');

describe('zip.js - Archive Utilities', () => {
    let mockArchive;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create a mock archiver instance
        mockArchive = {
            on: jest.fn(),
            pipe: jest.fn(),
            directory: jest.fn(),
            file: jest.fn(),
            finalize: jest.fn().mockResolvedValue(),
        };
        // Make the main archiver function return our mock instance
        archiver.mockReturnValue(mockArchive);

        // Use the real module's constants
        fs.BOX = 'BOX';
        fs.WEB = 'WEB';

        // Mock the return of our secure path resolver
        resolveSecurePath.mockImplementation((scope, p) => `/secure/${scope}/${p}`);
    });

    test('zipToFile should zip a directory with the correct paths', async () => {
        nodeFs.statSync.mockReturnValue({ isDirectory: () => true });
        nodeFs.existsSync.mockReturnValue(true);

        // Create a mock stream that correctly simulates the 'close' event.
        const mockWriteStream = {
            on: jest.fn((event, callback) => {
                // If the code is listening for the 'close' event,
                // we immediately call the callback to resolve the promise.
                if (event === 'close') {
                    callback();
                }
                return mockWriteStream; // Allow chaining .on() calls
            }),
            pipe: jest.fn(),
        };
        nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

        await als.run({} /* minimal context */, async () => {
            await zip.zipToFile(fs.BOX, 'my_folder', fs.BOX, 'archive.zip');
        });

        // The test will now complete without a timeout.
        expect(resolveSecurePath).toHaveBeenCalledWith(fs.BOX, 'my_folder');
        expect(mockArchive.directory).toHaveBeenCalledWith('/secure/BOX/my_folder', false);
    });

    test('unzip should call extract with the correct paths', async () => {
        nodeFs.existsSync.mockReturnValue(true);

        await als.run({} /* minimal context */, async () => {
            await zip.unzip(fs.WEB, 'archive.zip', fs.WEB, 'output_folder');
        });

        expect(resolveSecurePath).toHaveBeenCalledWith(fs.WEB, 'archive.zip');
        expect(resolveSecurePath).toHaveBeenCalledWith(fs.WEB, 'output_folder');

        // Verify extract was called with the resolved absolute paths
        expect(extract).toHaveBeenCalledWith('/secure/WEB/archive.zip', { dir: '/secure/WEB/output_folder' });
    });
});
