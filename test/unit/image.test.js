const { loadFromBuffer, loadFromFile } = require('../../modules/image');
const fs = require('../../modules/fs'); // We need to mock this dependency too

// Mock the entire 'sharp' library
jest.mock('sharp');
const sharp = require('sharp');

// Mock the 'fs' module because loadFromFile depends on it
jest.mock('../../modules/fs');

describe('image.js - Image Manipulation', () => {

    let mockSharpInstance;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
    });

    test('should chain operations and call sharp methods correctly', async () => {
        const dummyBuffer = Buffer.from('dummy_image_data');

        mockSharpInstance = {
          resize: jest.fn().mockReturnThis(),
          rotate: jest.fn().mockReturnThis(),
          flip: jest.fn().mockReturnThis(),
          flop: jest.fn().mockReturnThis(),
          greyscale: jest.fn().mockReturnThis(),
          blur: jest.fn().mockReturnThis(),
          sharpen: jest.fn().mockReturnThis(),
          composite: jest.fn().mockReturnThis(),
          toFormat: jest.fn().mockReturnThis(), // The missing method
          toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed_image_data')),
          // We also need to mock toFile for a complete test
          toFile: jest.fn().mockResolvedValue({ info: 'mock file saved' })
        };
        
        // Make the main sharp() function return our mock instance
        sharp.mockReturnValue(mockSharpInstance);

        const resultBuffer = await loadFromBuffer(dummyBuffer)
            .resize({ width: 500 })
            .greyscale()
            .blur(5)
            .format('webp', { quality: 80 }) // This will now work
            .toBuffer();
        
        // Assertions
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
        // Configure the fs mock to return our buffer
        fs.readFileSync.mockReturnValue(dummyBuffer);
        
        // Call the function under test
        loadFromFile(fs.BOX, './assets/photo.jpg');

        // Assert that our secure fs module was called correctly
        expect(fs.readFileSync).toHaveBeenCalledWith(fs.BOX, './assets/photo.jpg', {}); //options default is {}

        // Assert that sharp was then called with the buffer that fs returned
        expect(sharp).toHaveBeenCalledWith(dummyBuffer);
    });
});
