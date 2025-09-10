const { als } = require('../../modules/gingee');
const cache = require('../../modules/cache');

// Mock the service layer that the facade calls
jest.mock('../../modules/cache_service.js');
const cacheService = require('../../modules/cache_service.js');

describe('cache.js - App Module Facade', () => {
    const mockStore = { appName: 'my_app' };

    beforeEach(() => jest.clearAllMocks());

    test('get() should call the service with a namespaced key', async () => {
        await als.run(mockStore, async () => {
            await cache.get('user:123');
        });
        expect(cacheService.get).toHaveBeenCalledWith('my_app:user:123');
    });
    
    test('set() should call the service with a namespaced key and TTL', async () => {
        await als.run(mockStore, async () => {
            await cache.set('user:123', { name: 'test' }, 300);
        });
        expect(cacheService.set).toHaveBeenCalledWith('my_app:user:123', { name: 'test' }, 300);
    });

    test('clear() should call the service with a namespaced prefix', async () => {
        await als.run(mockStore, async () => {
            await cache.clear();
        });
        expect(cacheService.clear).toHaveBeenCalledWith('my_app:');
    });
});
