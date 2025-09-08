const path = require('path');
let activeAdapter;
let cacheSvcConfig;

async function init(cacheConfig = {}, logger) {
    serviceLogger = logger;
    const provider = (cacheConfig && cacheConfig.provider) || 'memory';

    let adapterPath;
    
    if (provider === 'redis') {
        adapterPath = path.join(__dirname, 'cache_drivers', 'redis_adapter.js');
    } else {
        adapterPath = path.join(__dirname, 'cache_drivers', 'memory_adapter.js');
    }

    try {
        const adapter = require(adapterPath);
        await adapter.init(cacheConfig, logger);
        activeAdapter = adapter;
        cacheSvcConfig = cacheConfig;
        logger.info(`[Cache] Successfully initialized with provider: '${provider}'`);
    } catch (e) {
        if (provider !== 'memory') { //fall back only if provider exception is not from memory cache, its fatal if it is from memory cache
            // If the chosen adapter fails (e.g., Redis timeout), we fall back to internal memory cache.
            logger.warn(`[Cache] WARN: Could not initialize cache provider '${provider}'. Falling back to 'memory'. Error: ${e.message}`);
            const memoryAdapter = require(path.join(__dirname, 'cache_drivers', 'memory_adapter.js'));
            memoryAdapter.init(cacheConfig, logger);
            cacheSvcConfig = cacheConfig;
            activeAdapter = memoryAdapter;
        }else{
            logger.error(`[Cache] ERROR: Could not initialize cache provider '${provider}'. Error: ${e.message}`);
            throw e;
        }
    }
}

async function get(key) {
    const result = await activeAdapter.get(key);
    return result ? JSON.parse(result) : null;
}

async function set(key, value, ttl) {
    ttl = ttl || (cacheSvcConfig && cacheSvcConfig.ttl) || 3600; // Default TTL is 3600 seconds (1 hour)
    return activeAdapter.set(key, JSON.stringify(value), ttl);
}

async function del(key) {
    return activeAdapter.del(key);
}
async function clear(prefix = '') {
    return activeAdapter.clear(prefix);
}

module.exports = {
    init,
    get,
    set,
    del,
    clear
};
