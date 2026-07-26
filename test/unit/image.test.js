// Factory mock so lazy require('sharp') in image.js gets a callable constructor
jest.mock('sharp', () => jest.fn());
// Mock the 'fs' module because loadFromFile depends on it
jest.mock('../../modules/fs');

describe('image.js - Image Manipulation', () => {
    let loadFromBuffer;
    let loadFromFile;
    let fs;
    let sharp;
    let mockSharpInstance;

    beforeEach(() => {
        // jest.config has resetModules: true — re-require so image.js and mocks share one graph.
        sharp = require('sharp');
        fs = require('../../modules/fs');
        ({ loadFromBuffer, loadFromFile } = require('../../modules/image'));

        mockSharpInstance = {
            resize: jest.fn().mockReturnThis(),
            rotate: jest.fn().mockReturnThis(),
            flip: jest.fn().mockReturnThis(),
            flop: jest.fn().mockReturnThis(),
            greyscale: jest.fn().mockReturnThis(),
            blur: jest.fn().mockReturnThis(),
            sharpen: jest.fn().mockReturnThis(),
            composite: jest.fn().mockReturnThis(),
            toFormat: jest.fn().mockReturnThis(),
            toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed_image_data')),
            toFile: jest.fn().mockResolvedValue({ info: 'mock file saved' })
        };
        sharp.mockReturnValue(mockSharpInstance);
    });

    test('should chain operations and call sharp methods correctly', async () => {
        const dummyBuffer = Buffer.from('dummy_image_data');

        const resultBuffer = await loadFromBuffer(dummyBuffer)
            .resize({ width: 500 })
            .greyscale()
            .blur(5)
            .format('webp', { quality: 80 })
            .toBuffer();

        expect(sharp).toHaveBeenCalledWith(dummyBuffer);
        expect(mockSharpInstance.resize).toHaveBeenCalledWith({ width: 500 });
        expect(mockSharpInstance.greyscale).toHaveBeenCalledTimes(1);
        expect(mockSharpInstance.blur).toHaveBeenCalledWith(5);
        expect(mockSharpInstance.toFormat).toHaveBeenCalledWith('webp', { quality: 80 });
        expect(mockSharpInstance.toBuffer).toHaveBeenCalledTimes(1);
        expect(resultBuffer.toString()).toBe('processed_image_data');
    });

    test('loadFromFile should use the fs module before loading the buffer', () => {
        const dummyBuffer = Buffer.from('dummy_image_data');
        fs.readFileSync.mockReturnValue(dummyBuffer);

        loadFromFile(fs.BOX, './assets/photo.jpg');

        expect(fs.readFileSync).toHaveBeenCalledWith(fs.BOX, './assets/photo.jpg', {});
        expect(sharp).toHaveBeenCalledWith(dummyBuffer);
    });
});
