const Redis = require('ioredis');

let redis;

async function init(config = {}, logger) {
    redis = new Redis({
        ...config,
        // Don't allow commands to be sent until a connection is established.
        enableReadyCheck: true,
        // Set a timeout for the initial connection attempt.
        connectTimeout: 3000 // 3 seconds
    });

    return new Promise((resolve, reject) => {
        // This event fires ONLY on a successful first connection.
        redis.on('ready', () => {
            logger.info("Redis cache adapter connected and ready.");
            // Clean up listeners to avoid memory leaks
            redis.removeAllListeners('error');
            resolve();
        });

        // This event fires if the initial connection fails.
        redis.on('error', (err) => {
            const errorMessage = `Redis initial connection failed: ${err.message}`;
            logger.error(errorMessage);
            // Clean up listeners
            redis.removeAllListeners('ready');
            // Stop the client from endlessly retrying in the background after we've failed.
            redis.disconnect();
            reject(new Error(errorMessage));
        });
    });
}

async function get(key) {
    return redis.get(key);
}

async function set(key, value, ttl) {
    await redis.set(key, value, 'EX', ttl);
}

async function del(key) {
    await redis.del(key);
}

async function clear(prefix = '') {
    const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
    const keysToDelete = [];
    await new Promise((resolve, reject) => {
        stream.on('data', keys => keysToDelete.push(...keys));
        stream.on('end', resolve);
        stream.on('error', reject);
    });
    if (keysToDelete.length > 0) {
        await redis.del(keysToDelete);
    }
}

module.exports = {
    init,
    get,
    set,
    del,
    clear
};
