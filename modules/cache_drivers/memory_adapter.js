const cache = new Map();

function init(cacheConfig) { 
    //do nothing for memory adapter
}

async function get(key) { 
    return cache.get(key) || null; 
}

async function set(key, value, ttl) { 
    cache.set(key, value); 
}

async function del(key) { 
    cache.delete(key); 
}

async function clear(prefix = '') {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

module.exports = { 
    init, 
    get, 
    set, 
    del, 
    clear 
};
