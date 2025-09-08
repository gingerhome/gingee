const cheerio = require('cheerio');
// We require our own modules to build upon them!
const fs = require('./fs.js'); //fs wrapper for secure file operations
const httpclient = require('./httpclient.js'); //httpclient wrapper for making HTTP requests

/**
 * @module html
 * @description A module for parsing and manipulating HTML using [Cheerio]{@link https://cheerio.js.org/}.
 * It provides functions to load HTML from strings, files, and URLs, allowing for easy querying and manipulation of HTML documents.
 * This module is particularly useful for web scraping, data extraction, and HTML manipulation tasks in GingerJS applications.
 * It abstracts the complexities of working with raw HTML, providing a simple and consistent API for developers.
 * It leverages the Cheerio library to provide a jQuery-like syntax for traversing and manipulating the HTML structure.
 * It supports both synchronous and asynchronous operations, making it flexible for various use cases.
 */

/**
 * The core function that loads an HTML string into Cheerio.
 * @param {string} htmlString - The raw HTML content.
 * @returns {cheerio.CheerioAPI} The Cheerio instance, typically represented as '$'.
 * @private
 */
function _loadHtml(htmlString) {
    if (typeof htmlString !== 'string') {
        throw new Error("Input to be parsed must be a string.");
    }
    return cheerio.load(htmlString);
}

/**
 * @function fromString
 * @memberof module:html
 * @description Parses an HTML document from a string.
 * This function takes a raw HTML string and returns a Cheerio instance for querying and manipulating the HTML content.
 * It is useful for scenarios where HTML content is dynamically generated or fetched from an external source.
 * @param {string} htmlString The raw HTML content to parse.
 * @returns {cheerio.CheerioAPI} The Cheerio instance for querying.
 * @example
 * const $ = html.fromString('<div class="test">Hello, World!</div>');
 * console.log($('.test').text()); // Outputs: Hello, World!
 * @throws {Error} If the input is not a string.
 */
function fromString(htmlString) {
    return _loadHtml(htmlString);
}

/**
 * @function fromFile
 * @memberof module:html
 * @description Reads and parses an HTML file from the secure filesystem.
 * This function allows you to load HTML content from a file, ensuring that the file is read securely within the GingerJS environment.
 * It uses the secure file system module to read the file content and then parses it into a Cheerio instance.
 * This is particularly useful for applications that need to manipulate or query HTML files stored in the GingerJS filesystem.
 * It abstracts the file reading process, providing a simple interface to work with HTML files.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the HTML file.
 * @returns {Promise<cheerio.CheerioAPI>} A Promise that resolves to the Cheerio instance.
 * @throws {Error} If the file cannot be read or parsed.
 * @example
 * const $ = await html.fromFile(fs.BOX, 'data/myfile.html');
 * console.log($('.test').text()); // Outputs the text content of the .test element
 */
async function fromFile(scope, filePath) {
    // Use our secure, async fs.readFile
    const fileContent = await fs.readFile(scope, filePath, 'utf8');
    return _loadHtml(fileContent);
}

/**
 * @function fromFileSync
 * @memberof module:html
 * @description Synchronously reads and parses an HTML file from the secure filesystem.
 * This function allows you to load HTML content from a file in a synchronous manner, ensuring that the file is read securely within the GingerJS environment.
 * It uses the secure file system module to read the file content and then parses it into a Cheerio instance.
 * This is particularly useful for applications that need to manipulate or query HTML files stored in the GingerJS filesystem in a synchronous context.
 * It abstracts the file reading process, providing a simple interface to work with HTML files.
 * @param {string} scope - The scope to operate in (fs.BOX or fs.WEB).
 * @param {string} filePath - The path to the HTML file.
 * @returns {cheerio.CheerioAPI} The Cheerio instance for querying.
 * @throws {Error} If the file cannot be read or parsed.
 * @example
 * const $ = html.fromFileSync(fs.BOX, 'data/myfile.html');
 * console.log($('.test').text()); // Outputs the text content of the .test element
 */
function fromFileSync(scope, filePath) {
    const fileContent = fs.readFileSync(scope, filePath, 'utf8');
    return _loadHtml(fileContent);
}

/**
 * @function fromUrl
 * @memberof module:html
 * @description Asynchronously fetches and parses an HTML document from a URL.
 * This function retrieves HTML content from a specified URL and returns a Cheerio instance for querying and manipulating the HTML.
 * It is useful for web scraping, data extraction, and any scenario where you need to work with HTML content from the web.
 * It abstracts the complexities of making HTTP requests and parsing the response, providing a simple interface for developers.
 * It ensures that the response is of the correct content type (text/html) before parsing. It supports only url with response of content type - 'text/html'.
 * @param {string} url The URL of the webpage to scrape.
 * @param {object} [options] - Options to be passed for the http call (like request headers).
 * @returns {Promise<cheerio.CheerioAPI>} A Promise that resolves to the Cheerio instance.
 * @throws {Error} If the response is not of type 'text/html' or if the HTML cannot be parsed.
 * @example
 * const $ = await html.fromUrl('https://example.com');
 * console.log($('.test').text()); // Outputs the text content of the .test element
 */
async function fromUrl(url, options = {}) {
  const response = await httpclient.get(url, options);

  const contentType = response.headers['content-type'] || '';
  if (!contentType.startsWith('text/html')) {
    throw new Error(
      `Invalid content type. Expected 'text/html' but received '${contentType}'.`
    );
  }
  
  // Our httpclient already ensures response.body is a string for text-based content types.
  if (typeof response.body !== 'string') {
      // This is a secondary safety check, though the check above is more specific.
      throw new Error(`Failed to fetch HTML from URL. Response body was not text. Status: ${response.status}`);
  }
  
  return _loadHtml(response.body);
}

module.exports = {
    fromString,
    fromFile,
    fromFileSync,
    fromUrl,
};
