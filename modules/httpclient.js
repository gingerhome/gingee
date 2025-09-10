const axios = require('axios');
const querystring = require('querystring');
const FormData = require('form-data');

/**
 * @module httpclient
 * @description A module for making HTTP requests in Gingee applications.
 * This module provides functions to perform GET and POST requests, supporting various content types.
 * It abstracts the complexities of making HTTP requests, providing a simple interface for developers to interact with web services.
 * It supports both text and binary responses, automatically determining the response type based on the content-type header.
 * It is particularly useful for applications that need to fetch resources from external APIs or web services, and for sending data to web services in different formats.
 * It allows for flexible data submission, making it suitable for APIs that require different content types.
 * It provides constants for common POST data types, ensuring that the correct headers are set for the request.
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

// --- Constants for POST data types ---
const POST_TYPES = {
    JSON: 'application/json',
    FORM: 'application/x-www-form-urlencoded',
    TEXT: 'text/plain',
    XML: 'application/xml',
    MULTIPART: 'multipart/form-data',
};

/**
 * Checks the response content-type header to see if it's likely binary.
 * @private
 */
function isBinaryResponse(headers) {
    const contentType = headers['content-type'] || '';
    // Added 'application/json' and 'text/' to the list of non-binary types.
    if (/^text\/|application\/(json|javascript|xml)/.test(contentType)) {
        return false;
    }
    // A more general check for common binary types.
    return /^image\/|audio\/|video\/|application\/(octet-stream|pdf|zip|msword)/.test(contentType);
}

/**
 * A helper to process the raw arraybuffer from axios based on response headers.
 * @private
 */
function processBody(data, headers) {
    const bodyBuffer = Buffer.from(data);
    if (isBinaryResponse(headers)) {
        // If it's binary, return the raw Buffer.
        return bodyBuffer;
    }
    // Otherwise, convert the Buffer to a string.
    return bodyBuffer.toString('utf8');
}


/**
 * @function get
 * @memberof module:httpclient
 * @description Performs an HTTP GET request.
 * This function retrieves data from a specified URL and returns the response status, headers, and body.
 * It supports both text and binary responses, automatically determining the response type based on the content-type header.
 * It abstracts the complexities of making HTTP requests, providing a simple interface for developers to fetch data from the web.
 * It can handle various content types, including JSON, text, and binary data, making it versatile for different use cases.
 * It is particularly useful for applications that need to fetch resources from external APIs or web services.
 * @param {string} url The URL to request.
 * @param {object} [options] Axios request configuration options (e.g., headers).
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @throws {Error} If the request fails or if the response body cannot be processed.
 * @example
 * const response = await httpclient.get('https://api.example.com/data');
 * console.log(response.body);
 */
async function get(url, options = {}) {
    // --- KEY CHANGE ---
    // Always request the raw arraybuffer so we can decide how to handle it later.
    const config = { ...options, responseType: 'arraybuffer' };

    try{
        const response = await axios.get(url, config);

        // Process the body based on the ACTUAL response headers.
        const body = processBody(response.data, response.headers);

        return {
            status: response.status,
            headers: response.headers,
            body: body,
        };
    }catch(axiosErr){
        if(axiosErr.response){
            // If we got a response, process it similarly.
            const body = processBody(axiosErr.response.data, axiosErr.response.headers);
            return {
                status: axiosErr.response.status,
                headers: axiosErr.response.headers,
                body: body,
            };
        }else{
            return {
                status: 500,
                headers: {},
                body: 'Unexpected error occurred: ' + (axiosErr.message || 'No message provided'),
            };
        }
    }
}

/**
 * @function post
 * @memberof module:httpclient
 * @description Performs an HTTP POST request.
 * This function sends data to a specified URL and returns the response status, headers, and body.
 * It supports various content types, including JSON, form-urlencoded, plain text, XML, and multipart/form-data.
 * It abstracts the complexities of making HTTP POST requests, providing a simple interface for developers to send data to web services.
 * It allows for flexible data submission, making it suitable for APIs that require different content types.
 * @param {string} url The URL to post to.
 * @param {any} body The data to send in the request body.
 * @param {object} [options] Axios request configuration options.
 * @param {string} [options.postType=httpclient.JSON] The type of data being posted.
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @throws {Error} If the request fails or if the body cannot be processed.
 * @example
 * const response = await httpclient.post('https://api.example.com/data', { key: 'value' });
 * console.log(response.body);
 */
async function post(url, body, options = {}) {
    const postType = options.postType || POST_TYPES.JSON;
    const config = {
        headers: { 'Content-Type': postType, ...options.headers },
        // --- KEY CHANGE ---
        // Always request the raw arraybuffer for the response.
        responseType: 'arraybuffer',
    };

    let data = body;
    // ... (The logic for preparing the POST data based on postType is unchanged) ...
    if (postType === POST_TYPES.JSON) data = JSON.stringify(body);
    if (postType === POST_TYPES.FORM) data = querystring.stringify(body);
    if (postType === POST_TYPES.MULTIPART) {
        if (!(body instanceof FormData)) throw new Error("For MULTIPART, body must use object created with formdata module.");
        delete config.headers['Content-Type'];
    }

    try{
        const response = await axios.post(url, data, config);

        // Process the body based on the ACTUAL response headers.
        const responseBody = processBody(response.data, response.headers);

        return {
            status: response.status,
            headers: response.headers,
            body: responseBody,
        };
    }catch(axiosErr){
        if(axiosErr.response){
            // If we got a response, process it similarly.
            const body = processBody(axiosErr.response.data, axiosErr.response.headers);
            return {
                status: axiosErr.response.status,
                headers: axiosErr.response.headers,
                body: body,
            };
        }else{
            return {
                status: 500,
                headers: {},
                body: 'Unexpected error occurred: ' + (axiosErr.message || 'No message provided'),
            };
        }
    }
}

module.exports = {
    get,
    post,
    /**
     * @constant JSON
     * @memberof module:httpclient
     * @description Constant for JSON content type in POST requests.
     * This constant can be used to specify that the POST request body is in JSON format.
     */
    JSON: POST_TYPES.JSON,
    /**
     * @constant FORM
     * @memberof module:httpclient
     * @description Constant for form-urlencoded content type in POST requests.
     * This constant can be used to specify that the POST request body is in form-urlencoded format.
     */
    FORM: POST_TYPES.FORM,
    /**
     * @constant TEXT
     * @memberof module:httpclient
     * @description Constant for plain text content type in POST requests.
     * This constant can be used to specify that the POST request body is in plain text format.
     */
    TEXT: POST_TYPES.TEXT,
    /**
     * @constant XML
     * @memberof module:httpclient
     * @description Constant for XML content type in POST requests.
     * This constant can be used to specify that the POST request body is in XML format.
     */
    XML: POST_TYPES.XML,
    /**
     * @constant MULTIPART
     * @memberof module:httpclient
     * @description Constant for multipart/form-data content type in POST requests.
     * This constant can be used to specify that the POST request body is in multipart/form-data format.
     */
    MULTIPART: POST_TYPES.MULTIPART,
};
