# Understanding GingerJS Scripts

GingerJS executes your backend logic using JavaScript files that live inside your app's secure `box` folder. For consistency and ease of use, all executable scripts—whether they are handling a live API request, acting as middleware, or performing a one-time setup task—share the same fundamental structure. This guide explains the three types of scripts and the powerful `$g` object that connects them.

## The Consistent Script Pattern

All GingerJS scripts, regardless of their purpose, follow this simple and mandatory pattern:

```javascript
// A script must export a single asynchronous function.
module.exports = async function() {

    // The entire logic is wrapped in a call to the global 'ginger()' function.
    await ginger(async function($g) {

        // Your application code goes here.
        // You use the '$g' object to interact with the world.
        
    });
};
```
This unified structure ensures that every piece of executable code runs within the same secure, sandboxed environment and receives a properly configured context object (`$g`).

## Types of Scripts in GingerJS

While the structure is the same, the purpose of a script and the context it runs in can differ. There are three types of scripts you can create.

### 1. Server Scripts (API Endpoints)

This is the most common type of script. It runs in direct response to an incoming HTTP request from a browser or client.

-   **Purpose:** To handle API requests (e.g., fetching data, creating a user, processing a form).
-   **Execution:** Triggered by the GingerJS routing engine when a URL matches either a file path or a route defined in `routes.json`.
-   **`$g` Context:** Has access to the **full** `$g` object, including:
    *   `$g.request`: To get headers, query parameters, and the request body.
    *   `$g.response`: To send a response back to the client.
    *   `$g.log` and `$g.app`.

**Example (`box/api/users/get.js`):**
```javascript
module.exports = async function() {
    await ginger(async ($g) => {
        const userId = $g.request.query.id;
        // ... logic to fetch user from database ...
        $g.response.send({ id: userId, name: 'Alex' });
    });
};
```

### 2. Default Include Scripts (Middleware)

These scripts run *before* every Server Script in your application. They act as middleware.

-   **Purpose:** To run common, request-level logic for every endpoint, such as checking for a valid authentication token, logging every request, or adding common security headers.
-   **Execution:** Configured in `app.json` via the `"default_include"` array. They run in the order they are listed, before the final Server Script is executed.
-   **`$g` Context:** Has access to the **full** `$g` object, just like a Server Script. A key feature is that if a Default Include script uses `$g.response.send()`, the request lifecycle is immediately terminated, and no further scripts (including the main Server Script) will be executed.

**Example (`box/auth_middleware.js`):**
```javascript
module.exports = async function() {
    await ginger(async ($g) => {
        const token = $g.request.headers['x-auth-token'];
        if (!isValid(token)) {
            // This ends the request immediately.
            $g.response.send({ error: 'Unauthorized' }, 401);
        }
        // If we don't send a response, execution continues to the next script.
    });
};
```

### 3. Startup Scripts (Initialization)

These scripts run **once** when your application is loaded by the server. They are not tied to any HTTP request.

-   **Purpose:** To perform one-time setup and initialization tasks for your application. Common uses include creating database tables if they don't exist, seeding the database with default data, or warming up a cache.
-   **Execution:** Configured in `app.json` via the `"startup-scripts"` array. They run in the order they are listed when the GingerJS server starts, when an app is newly installed, or after an app is upgraded or rolled back.
-   **`$g` Context:** Receives a **specialized, non-HTTP** version of the `$g` object.
    *   **Available:** `$g.log`, `$g.app`.
    *   **NOT Available:** `$g.request` and `$g.response` are `null`, as there is no incoming request or outgoing response.
    *   **Important:** If a startup script throws an error, it is considered a fatal initialization failure, and the entire GingerJS server will shut down to prevent it from running in an unstable state.

**Example (`box/setup/create_schema.js`):**
```javascript
module.exports = async function() {
    await ginger(async ($g) => {
        const db = require('db');
        $g.log.info('Checking for Users table...');
        
        const sql = 'CREATE TABLE IF NOT EXISTS "Users" (id SERIAL PRIMARY KEY, email TEXT)';
        await db.execute('main_db', sql);
        
        $g.log.info('Database schema is ready.');
    });
};
```

---

## The `$g` Object: Full API Reference

The `$g` object is the heart of the server script API. It provides a simplified and secure facade for interacting with the HTTP request, building a response, logging, and accessing application configuration.

### `$g.request`

An object containing all the details of the incoming HTTP request. 

-   **`$g.request.url`**
    -   **Type:** `URL` object
    -   **Description:** The full, parsed URL of the request, including protocol, host, path, and query string.

-   **`$g.request.protocol`**
    -   **Type:** `string`
    -   **Description:** The protocol of the request, either `'http'` or `'https'`.

-   **`$g.request.hostname`**
    -   **Type:** `string`
    -   **Description:** The hostname from the `Host` header (e.g., `'localhost:7070'`).

-   **`$g.request.method`**
    -   **Type:** `string`
    -   **Description:** The HTTP method of the request (e.g., `'GET'`, `'POST'`, `'PUT'`).

-   **`$g.request.path`**
    -   **Type:** `string`
    -   **Description:** The path portion of the URL (e.g., `'/users/list'`).

-   **`$g.request.headers`**
    -   **Type:** `object`
    -   **Description:** An object containing all HTTP request headers, with keys in lowercase (e.g., `$g.request.headers['user-agent']`).

-   **`$g.request.cookies`**
    -   **Type:** `object`
    -   **Description:** An object of all cookies sent by the client, pre-parsed into key-value pairs.

-   **`$g.request.query`**
    -   **Type:** `object`
    -   **Description:** An object of all query string parameters from the URL, pre-parsed into key-value pairs.

-   **`$g.request.params`**
    -   **Type:** `object`
    -   **Description:** An object containing key-value pairs of the dynamic path parameters extracted from the URL, as defined in `routes.json`.
    -   **Example:** For a route defined with `path: "/users/:userId/posts/:postId"` and a request to `/users/123/posts/abc`, `$g.request.params` would be `{ "userId": "123", "postId": "abc" }`.

-   **`$g.request.body`**
    -   **Type:** `object` | `string` | `null`
    -   **Description:** The pre-parsed body of the request. The `ginger()` middleware automatically parses the body based on the `Content-Type` header.
        -   For `application/json`: An object.
        -   For `application/x-www-form-urlencoded`: An object.
        -   For `multipart/form-data`: An object containing text fields and a `files` object. Each file in `files` includes its `name`, `type`, `size`, and its content as a `Buffer` in the `data` property.
        -   For other content types, it may be a raw string or `null`.

### `$g.response`

An object used to build the outgoing HTTP response. You modify its properties and then call `$g.response.send()` to send it.

-   **`$g.response.status`**
    -   **Type:** `number`
    -   **Default:** `200`
    -   **Description:** The HTTP status code to be sent. Set this before calling `send()`.
    -   **Example:** `$g.response.status = 404;`

-   **`$g.response.headers`**
    -   **Type:** `object`
    -   **Default:** `{ 'Content-Type': 'text/plain' }`
    -   **Description:** An object of HTTP headers to be sent with the response.

-   **`$g.response.cookies`**
    -   **Type:** `object`
    -   **Description:** An object of cookies to set on the client. The key is the cookie name, and the value is the cookie value. The `send()` method will format these into `Set-Cookie` headers.
    -   **Note:** For advanced options (like `HttpOnly`, `maxAge`), use the `cookie` module. This is a shortcut for simple key-value cookies.

-   **`$g.response.body`**
    -   **Type:** `any`
    -   **Default:** `null`
    -   **Description:** A property to hold the response body before sending. It's often more direct to just pass the data to the `send()` method.

-   **`$g.response.send(data, [status], [contentType])`**
    -   **Description:** The final method you call to send the response. It intelligently handles different data types.
    -   **`data`**: The content to send.
        -   If `string` or `Buffer`, it's sent as-is.
        -   If `object` or `Array`, it is automatically `JSON.stringify()`-ed, and the `Content-Type` is set to `application/json`.
    -   **`status` (optional):** A `number` to set the HTTP status code, overriding `$g.response.status`.
    -   **`contentType` (optional):** A `string` to set the `Content-Type` header, overriding `$g.response.headers['Content-Type']`.
    -   **Example (JSON):** `$g.response.send({ user: 'test' });`
    -   **Example (Image):** `$g.response.send(imageBuffer, 200, 'image/png');`

### `$g.log`

A direct reference to the apps's logger instance, pre-configured with the request's context.

-   **Methods:**
    -   **`$g.log.info(message, [meta])`**
    -   **`$g.log.warn(message, [meta])`**
    -   **`$g.log.error(message, [meta])`**
-   **Description:** Use these methods for structured logging. The `message` is a string, and the optional `meta` object can contain any additional data you want to log (like a user ID or a full error stack).

### `$g.app`

An object containing safe, read-only configuration data for the current application.

-   **`$g.app.name`**: (string) The app's display name from `app.json`.
-   **`$g.app.version`**: (string) The app's version from `app.json`.
-   **`$g.app.description`**: (string) The app's description from `app.json`.
-   **`$g.app.env`**: (object) The custom environment variables defined in the `env` block of `app.json`.

**NOTE:** The $g object will not have the $g.request and $g.response objects for a startup script.
