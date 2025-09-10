const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();

const { URL } = require('url');
const querystring = require('querystring');
const { formidable } = require('formidable');

const fs = require('fs');
const path = require('path');

function _parseSize(sizeStr) {
    if (typeof sizeStr !== "string") {
        throw new Error("Input must be a string");
    }

    // Trim and normalize
    const str = sizeStr.trim().toUpperCase();

    // Match number + unit (KB, MB, GB, TB, etc.)
    const match = str.match(/^([\d.]+)\s*([KMGTPE]?I?B?)$/i);
    if (!match) {
        throw new Error("Invalid size format: " + sizeStr);
    }

    const value = parseFloat(match[1]);
    let unit = match[2].toUpperCase();

    // Default to bytes if no unit
    if (!unit || unit === "B") return value;

    const units = {
        B: 1,
        KB: 1000,
        MB: 1000 ** 2,
        GB: 1000 ** 3,
        TB: 1000 ** 4,
        PB: 1000 ** 5,
        EB: 1000 ** 6,

        // IEC binary units
        KIB: 1024,
        MIB: 1024 ** 2,
        GIB: 1024 ** 3,
        TIB: 1024 ** 4,
        PIB: 1024 ** 5,
        EIB: 1024 ** 6
    };

    if (!(unit in units)) {
        throw new Error("Unknown unit: " + unit);
    }

    return value * units[unit];
}

module.exports = {
    als,
    getContext: () => {
        const store = als.getStore();
        if (!store) {
            throw new Error("No context found");
        }
        return store;
    },
    gingee: async (handler) => {
        const store = als.getStore();
        if (!store) {
            throw new Error("gingee must be called within a request's asynchronous execution context only.");
        }

        const isHttpContext = store.req && store.res;

        if (isHttpContext && store.$g && store.$g.isCompleted) {
            store.logger.info(`Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`);
            return;
        }

        try {
            if (!store.$g)
                store.$g = {};

            store.$g.log = store.logger;
            store.$g.app = {
                name: store.app.config.name,
                version: store.app.config.version,
                description: store.app.config.description,
                env: store.app.config.env
            };
            store.$g.request = null;
            store.$g.response = null;

            if (store.isPrivileged) {
                store.$g.appNames = store.appNames;
                store.$g.apps = store.allApps;
            }

            if (isHttpContext) {
                const utils = {
                    parseCookies: (req) => {
                        const list = {};
                        const cookieHeader = req.headers?.cookie; // Access the 'cookie' header

                        if (!cookieHeader) return list; // Return empty object if no cookie header

                        cookieHeader.split(';').forEach(function (cookie) {
                            let [name, ...rest] = cookie.split('=');
                            name = name?.trim();
                            if (!name) return; // Skip if cookie name is empty

                            const value = rest.join('=').trim(); // Handle potential '=' in cookie value
                            if (!value) return; // Skip if cookie value is empty

                            list[name] = decodeURIComponent(value); // Decode URI components for the value
                        });

                        return list;
                    },

                    request: (req) => {
                        const isHttps = req.connection.encrypted; // Check if the connection is encrypted
                        const protocol = isHttps ? 'https' : 'http';
                        const fullUrl = new URL(req.url, `${protocol}://${req.headers.host}`);

                        return {
                            protocol: protocol,
                            hostname: req.headers.host,
                            method: req.method,
                            path: fullUrl.pathname,
                            url: fullUrl,
                            headers: req.headers,
                            cookies: utils.parseCookies(req),
                            query: Object.fromEntries(fullUrl.searchParams),
                            params: store.routeParams || {},
                            body: req.body
                        };
                    },

                    response: (res) => {
                        return {
                            status: 200,
                            headers: {
                                'Content-Type': 'text/plain'
                            },
                            cookies: {},
                            body: null,

                            send: (data, status, contentType) => {
                                if (store.$g && store.$g.isCompleted) {
                                    // Prevent double-sending
                                    store.logger.warn(`response.send() called multiple times. Original call from '${store.$g.completedBy}'. New call from '${path.basename(store.scriptPath)}' ignored.`);
                                    return;
                                }
                                store.$g.isCompleted = true;
                                store.$g.completedBy = path.basename(store.scriptPath);
                                store.logger.info(`Response sent by: ${store.$g.completedBy}`);

                                res.statusCode = status || response.status || 200;

                                let headerKeys = Object.keys(response.headers);
                                if (headerKeys.length > 0) {
                                    headerKeys.forEach(key => {
                                        res.setHeader(key, response.headers[key]);
                                    });
                                }

                                let cookieKeys = Object.keys(response.cookies);
                                if (cookieKeys.length > 0) {
                                    var cookieStrings = cookieKeys.map(key => {
                                        return `${key}=${response.cookies[key]}`;
                                    });
                                    res.setHeader('Set-Cookie', cookieStrings);
                                }

                                if (contentType) {
                                    res.setHeader('Content-Type', contentType);
                                }

                                if (data) {
                                    if (Buffer.isBuffer(data)) {
                                        res.setHeader('Content-Length', data.length);
                                    } else if (typeof data === 'object') {
                                        data = JSON.stringify(data);
                                        res.setHeader('Content-Type', 'application/json');
                                    }
                                }
                                res.end(data);
                            }
                        };
                    }
                }

                const response = utils.response(store.res);
                store.$g.request = utils.request(store.req);
                store.$g.response = response;
                response.send = response.send.bind(response);

                const req = store.req;

                if (req.method === 'GET' || !req.headers['content-type']) {
                    //body is not present in GET requests, so we can directly call the handler
                    //ignored if it is present
                    store.$g.request.body = null;
                    await handler(store.$g);
                    return;
                }

                const hasBody = req.headers['content-length'] > '0' || req.headers['transfer-encoding'] !== undefined;
                if (!hasBody) {
                    store.$g.request.body = null;
                    await handler(store.$g);
                    return;
                }

                let maxBodySize = _parseSize(store.maxBodySize);
                if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
                    const bodyChunks = [];
                    let receivedBytes = 0;
                    let payloadExceeded = false;

                    // Listen for incoming data chunks.
                    req.on('data', chunk => {
                        receivedBytes += chunk.length;

                        if (payloadExceeded)
                            return;

                        if (receivedBytes > maxBodySize) {
                            store.logger.warn(`Request body size limit exceeded for ${req.url}. Limit: ${maxBodySize}, Received: ${receivedBytes}`);
                            payloadExceeded = true;
                        } else {
                            bodyChunks.push(chunk);
                        }
                    });

                    // Listen for the 'end' event, which signifies the body has been fully received.
                    req.on('end', async () => {
                        if (store.$g && store.$g.isCompleted) {
                            store.logger.info(`Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`);
                            return;
                        }

                        als.run(store, async () => {
                            try {
                                if (payloadExceeded) {
                                    store.$g.request.body = { error: "Payload size exceeded" };
                                }

                                if (store.$g.request.body) {
                                    store.$g.log.info(`Body already processed, skipping for ${path.basename(store.scriptPath)}`);
                                    await handler(store.$g);
                                    return;
                                }

                                if (!bodyChunks || bodyChunks.length === 0) {
                                    store.$g.request.body = null;
                                    await handler(store.$g);
                                    return;
                                }

                                const requestBody = Buffer.concat(bodyChunks).toString();
                                try {
                                    store.$g.request.body = querystring.parse(requestBody);
                                    await handler(store.$g);
                                } catch (err) {
                                    store.$g.log.error(`Error parsing request body: ${err.message} for ${store.$g.request.path}`);
                                    store.$g.request.body = requestBody; // Fallback to raw string if parsing fails
                                    await handler(store.$g);
                                }
                            } catch (err) {
                                if (store && store.logger) {
                                    store.logger.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                } else {
                                    console.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                }
                                if (!store.$g.isCompleted) {
                                    store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                                    store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                                    store.$g.isCompleted = true;
                                }
                            }
                        });
                    });
                } else if (req.headers['content-type'] === 'application/json') {
                    const bodyChunks = [];
                    let receivedBytes = 0;
                    let payloadExceeded = false;

                    // Listen for incoming data chunks.
                    req.on('data', chunk => {
                        receivedBytes += chunk.length;

                        if (payloadExceeded)
                            return;

                        if (receivedBytes > maxBodySize) {
                            store.logger.warn(`Request body size limit exceeded for ${req.url}. Limit: ${maxBodySize}, Received: ${receivedBytes}`);
                            payloadExceeded = true;
                        } else {
                            bodyChunks.push(chunk);
                        }
                    });

                    // Listen for the 'end' event, which signifies the body has been fully received.
                    req.on('end', async () => {
                        if (store.$g && store.$g.isCompleted) {
                            store.logger.info(`Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`);
                            return;
                        }

                        als.run(store, async () => {
                            try {
                                if (payloadExceeded) {
                                    store.$g.request.body = { error: "Payload size exceeded" };
                                }

                                if (store.$g.request.body) {
                                    store.$g.log.info(`Body already processed, skipping for ${path.basename(store.scriptPath)}`);
                                    await handler(store.$g);
                                    return;
                                }

                                if (!bodyChunks || bodyChunks.length === 0) {
                                    store.$g.request.body = null;
                                    await handler(store.$g);
                                    return;
                                }

                                // Concatenate the chunks into a single Buffer, then convert to a string.
                                const requestBody = Buffer.concat(bodyChunks).toString();
                                try {
                                    store.$g.request.body = JSON.parse(requestBody);
                                    await handler(store.$g);
                                } catch (jsonErr) {
                                    store.$g.log.error(`Error parsing request body: ${jsonErr.message} for ${store.$g.request.path}`);
                                    store.$g.request.body = requestBody; // Fallback to raw string if JSON parsing fails
                                    await handler(store.$g);
                                }
                            } catch (err) {
                                if (store && store.logger) {
                                    store.logger.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                } else {
                                    console.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                }
                                if (store.$g && !store.$g.isCompleted) {
                                    store.$g.isCompleted = true;
                                    store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                                    store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                                }
                            }
                        });
                    });
                } else if (req.headers['content-type'].indexOf('multipart/form-data') === 0) { //content-type starts with multipart/form-data
                    const form = formidable({ multiples: true, keepExtensions: true, maxTotalFileSize: maxBodySize });

                    form.on('error', (err) => {
                        // Handle formidable's specific 'maxTotalFileSize' error
                        if (err.code === 1009) { // formidable's error code for max size exceeded
                            store.logger.warn(`Multipart request size limit exceeded for ${req.url}`);
                        }
                    });

                    form.parse(req, async (err, fields, uploadedFiles) => {
                        if (store.$g && store.$g.isCompleted) {
                            store.logger.info(`Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`);
                            return;
                        }

                        als.run(store, async () => {
                            try {
                                if (err) {
                                    store.$g.log.error(`Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`);
                                    if ((err.code === 1009)) {
                                        store.$g.request.body = { error: "Payload limit exceeded" };
                                        await handler(store.$g);
                                        return;
                                    } else {
                                        store.$g.log.info(`Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`);
                                    }
                                }

                                if (store.$g.request.body) {
                                    store.$g.log.info(`Body already processed, skipping for ${path.basename(store.scriptPath)}`);
                                    await handler(store.$g);
                                    return;
                                }

                                var files = {};
                                var fileFields = Object.keys(uploadedFiles);
                                fileFields.forEach(fileField => {
                                    let file = uploadedFiles[fileField][0];
                                    files[fileField] = {
                                        name: file.originalFilename,
                                        type: file.mimetype,
                                        size: file.size
                                    };
                                    // Ensure the file path is absolute
                                    if (fs.existsSync(file.filepath)) {
                                        let fPath = path.resolve(file.filepath);
                                        const fileBuffer = fs.readFileSync(fPath);
                                        files[fileField].data = fileBuffer;
                                    }
                                });
                                store.$g.request.body = { ...fields, files };
                                await handler(store.$g);
                            } catch (err) {
                                if (store && store.logger) {
                                    store.logger.error(`Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                } else {
                                    console.error(`Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                }
                                if (store.$g && !store.$g.isCompleted) {
                                    store.$g.isCompleted = true;
                                    store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                                    store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                                }
                            }
                        });
                    });
                } else {
                    try {
                        const bodyChunks = [];
                        let receivedBytes = 0;
                        let payloadExceeded = false;

                        // Listen for incoming data chunks.
                        req.on('data', chunk => {
                            receivedBytes += chunk.length;

                            if (payloadExceeded)
                                return;

                            if (receivedBytes > maxBodySize) {
                                store.logger.warn(`Request body size limit exceeded for ${req.url}. Limit: ${maxBodySize}, Received: ${receivedBytes}`);
                                payloadExceeded = true;
                            } else {
                                bodyChunks.push(chunk);
                            }
                        });

                        // Listen for the 'end' event, which signifies the body has been fully received.
                        req.on('end', async () => {
                            if (store.$g && store.$g.isCompleted) {
                                store.logger.info(`Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`);
                                return;
                            }
                            
                            als.run(store, async () => {
                                try {
                                    if (payloadExceeded) {
                                        store.$g.request.body = { error: "Payload size exceeded" };
                                    }

                                    if (store.$g.request.body) {
                                        store.$g.log.info(`Body already processed, skipping for ${path.basename(store.scriptPath)}`);
                                        await handler(store.$g);
                                        return;
                                    }

                                    if (!bodyChunks || bodyChunks.length === 0) {
                                        store.$g.request.body = null;
                                        await handler(store.$g);
                                        return;
                                    }

                                    const requestBody = Buffer.concat(bodyChunks).toString();
                                    store.$g.request.body = requestBody; // Fallback to raw string if parsing fails
                                    await handler(store.$g);
                                } catch (err) {
                                    if (store && store.logger) {
                                        store.logger.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                    } else {
                                        console.error(`Error processing request body: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                                    }
                                    if (store.$g && !store.$g.isCompleted) {
                                        store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                                        store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                                        store.$g.isCompleted = true;
                                    }
                                }
                            });
                        });
                    } catch (err) {
                        if (store && store.logger) {
                            store.logger.error(`Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                        } else {
                            console.error(`Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`, { stack: err.stack });
                        }
                        if (store.$g && !store.$g.isCompleted) {
                            store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                            store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                            store.$g.isCompleted = true;
                        }
                    }
                }
            } else {
                // Non-HTTP context, e.g. startup scripts: just call the handler
                await handler(store.$g);
            }
        } catch (err) {
            if (store && store.logger) {
                store.logger.error(`Error in gingee middleware: ${err.message} in app ${store.appName} found in script ${path.basename(store.scriptPath)}`, { stack: err.stack });
            } else {
                console.error(`Error in gingee middleware: ${err.message} in app ${store.appName} found in script ${path.basename(store.scriptPath)}`, { stack: err.stack });
            }
            if (isHttpContext && store.$g && !store.$g.isCompleted) {
                store.res.writeHead(500, { 'Content-Type': 'text/plain' });
                store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
                store.$g.isCompleted = true;
            }
        }
    }
};
