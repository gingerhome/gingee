// This module wraps the 'form-data' library to provide a simple factory function.
const FormData = require('form-data');

/**
 * @module formdata
 * @description Provides a factory function to create FormData instances.
 * This module is used to handle form data in HTTP requests, allowing for easy construction of multipart/form-data requests.
 * It simplifies the process of appending fields and files to the form data, and provides a method to get headers for use with HTTP clients.
 * It is particularly useful for uploading files and sending complex data structures in web applications.
 * It abstracts the complexities of constructing multipart requests, making it easier to work with file uploads and form submissions.
 */

/**
 * @function create
 * @memberof module:formdata
 * @description Creates a new FormData instance.
 * This function initializes a FormData object that can be used to append fields and files for HTTP requests.
 * It provides a simple interface for constructing multipart/form-data requests, which is commonly used for file uploads and form submissions.
 * It allows developers to easily add data to the form, including text fields and binary files,
 * and retrieve the necessary headers for sending the form data in HTTP requests.
 * @returns {FormData} A new FormData instance.
 * @example
 * const form = formdata.create();
 * form.append('name', 'GingerJS App Server');
 * form.append('description', 'This is the GingerJS mascot.');
 * form.append('image', fs.readFileSync(fs.BOX, './images/ginger.png'), 'ginger.png');
 * const headers = form.getHeaders();
 */
function create() {
    return new FormData();
}

module.exports = {
    create
};
