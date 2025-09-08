# Anatomy of a GingerJS App

Every application built on GingerJS follows a simple and consistent structure. This guide breaks down that structure, explains the critical role of the `box` folder, and provides a comprehensive reference for all the settings available in the `app.json` and `routes.json` configuration file.

## App Folder Structure

Every first-level directory inside your server's `web` root is considered a distinct **App**. For an application named `my_app`, the structure looks like this:

```
web/
└── my_app/
    ├── box/
    ├── css/
    ├── images/
    ├── scripts/
    └── index.html
```

- **`my_app/`**: The root folder for the application. The name of this folder becomes the app's unique ID and the first segment of its URL (e.g., `http://localhost/my_app/...`).

- **`css/`, `images/`, `scripts/`, etc.:** These are **public** directories. Any file placed here can be accessed directly by its URL. GingerJS's static file server will serve these assets. For example, a file at `web/my_app/css/style.css` is available at `/my_app/css/style.css`.

- **`index.html`**: If a user navigates to the app's root URL (`/my_app`), this file will be served by default (if the app is not an SPA).

### The Importance of the `box` Folder

The `box` folder is the **private, secure core** of your application. It contains all your backend logic, configuration, and private data.

- **Security:** The `box` folder is **always protected**. No file inside the `box` can ever be accessed directly from a URL. A request to `/my_app/box/app.json`, for example, will be blocked with a `403 Access Denied` error. This is a fundamental security guarantee of the GingerJS platform.

- **Server Scripts:** All your backend API endpoints are JavaScript files that live inside the `box`. A request to `/my_app/api/users` is mapped to the file at `web/my_app/box/api/users.js`.

- **Configuration:** All app-specific configuration, including the crucial `app.json` file, resides in the `box`.

- **Private Data:** If your application uses a file-based database like SQLite, its database file should be stored in a subdirectory within the `box` (e.g., `box/data/app.db`) to ensure it is protected from direct web access.

---

## The `app.json` File:

The `app.json` file, located at `web/my_app/box/app.json`, is the central configuration file for your application. It tells the GingerJS server how to handle the app, what resources it needs, and how it should behave.

Here is a comprehensive breakdown of all available properties.

```json
{
  "name": "My Awesome App",
  "description": "This is a demonstration of all app.json settings.",
  "version": "1.2.0",
  "type": "MPA",
  "db": [],
  "startup_scripts": [],
  "default_include": [],
  "env": {},
  "jwt_secret": "a-very-strong-and-unique-secret-key",
  "cache": {
    "client": {
      "enabled": true,
      "no_cache_regex": ["/api/realtime"]
    },
    "server": {
      "enabled": true,
      "no_cache_regex": ["/api/dynamic-script.js"]
    }
  }
}
```

### Core Metadata

- **`name`** (string, required)
- **`description`** (string, optional)
- **`version`** (string, optional)

### Application Type

- **`type`** (string, optional)
  - **`"MPA"`** (Multi-Page Application): The default.
  - **`"SPA"`** (Single Page Application - NOT IMPLEMENTED YET): Activates "SPA Fallback" for client-side routing.

### Database Connections

- **`db`** (array, optional)
  - An array of database connection objects.
  - **Properties:** `type`, `name`, `host`, `user`, `password`, `database`, etc.

### Script Execution Configuration

- **`startup_scripts`** (array, optional)
  - An array of strings specifying script paths relative to the `box` folder.
  - **Purpose:** These scripts are executed **once in sequential order** when the application is first loaded by the server (on startup, after an install, or after an upgrade/rollback).
  - **Use Cases:** Ideal for database schema creation/migration, seeding initial data, or warming up the application cache.
  - **Example:** `"startup_scripts": ["setup/01_schema.js", "setup/02_seed_data.js"]`

- **`default_include`** (array, optional)
  - An array of strings specifying "middleware" scripts to be executed **before every server script** in the app.
  - **Purpose:** Perfect for setting up common, request-level logic like authentication checks, request logging, or setting common response headers.
  - **Path Resolution:**
    - If the string has a file extension (e.g., `"lib/auth.js"`), it is resolved as a path relative to the app's `box` folder.
    - If it has no extension (e.g., `"auth"`), it is resolved from the global `modules` folder.
  - **Example:** `"default_include": ["auth_middleware.js", "lib/request_logger.js"]`

- **`env`** (object, optional)
  - A key-value store for non-sensitive environment variables, made available at `$g.app.env`.

- **`jwt_secret`** (string, optional)
  - A strong, unique secret key used by the `auth` module for creating and verifying JSON Web Tokens (JWTs).

### Cache

- **`cache`** (object, optional)
  - Defines the caching **strategy** for this specific application.
  - **`cache.client`**: Controls browser caching (`Cache-Control` header).
  - **`cache.server`**: Controls server-side caching of static files and transpiled scripts in Memory or Redis.

---

### The `pmft.json` File (Permissions Manifest)

If you plan to distribute your application as a `.gin` package, you must declare the permissions it requires in a `pmft.json` file. This manifest is read by the `gingerjs-cli` during the installation process to request consent from the server administrator.

-   **Location:** `web/<your-app-name>/box/pmft.json`
-   **Purpose:** To declare your app's required (`mandatory`) and optional (`optional`) permissions.

For a complete guide on the permissions system and the structure of this file, please see the **GingerJS Permissions Guide [MD](./permissions-guide.md) [HTML](./permissions-guide.html)**.

---

## The `routes.json` File (Manifest-Based Routing)

For applications that require more powerful and flexible routing, such as RESTful APIs with dynamic path parameters, you can create a `routes.json` file. When this file is present in an app's `box` folder, it **activates manifest-based routing**, which takes precedence over the default file-based routing.

-   **Location:** `web/my-app/box/routes.json`
-   **Purpose:** To explicitly map URL path patterns and HTTP methods to specific server script files.

#### Structure of `routes.json`

The file must contain a single root object with a `routes` key, which holds an array of route definition objects.

```json
{
  "routes": [
    {
      "path": "/users",
      "method": "GET",
      "script": "users/list.js"
    },
    {
      "path": "/users/:userId",
      "method": "GET",
      "script": "users/get.js"
    },
    {
      "path": "/users/:userId",
      "method": "PUT",
      "script": "users/update.js"
    },
    {
      "path": "/:category/:slug/images/:imageId?",
      "method": "GET",
      "script": "content/view.js"
    }
  ]
}
```

#### Route Definition Properties

Each object in the `routes` array defines a single endpoint and has the following properties:

-   **`path`** (string, required)
    -   **Description:** A URL path pattern that can include static segments and dynamic, named parameters.
    -   **Dynamic Parameters:** A parameter is defined by a colon (`:`), followed by its name (e.g., `:userId`). The name should use standard variable naming conventions.
    -   **Optional Parameters:** A parameter can be made optional by adding a question mark (`?`) to its name (e.g., `:imageId?`).
    -   **Wildcards:** You can use an asterisk (`*`) as a wildcard to match the rest of a path.

-   **`method`** (string, optional)
    -   **Description:** The HTTP method that this route will respond to. The matching is case-insensitive.
    -   **Default:** If omitted, the method defaults to `GET`.
    -   **Supported Values:** Standard HTTP verbs like `GET`, `POST`, `PUT`, `DELETE`, `PATCH`. You can also use `ALL` to match any method for a given path.

-   **`script`** (string, required)
    -   **Description:** The path to the server script file that should be executed when this route is matched. The path is **relative to the `box` folder**. The `.js` extension is optional.
    -   **Example:** `"script": "api/users/get-profile"` will execute the file at `web/my-app/box/api/users/get-profile.js`.

#### Accessing Path Parameters

When a route with dynamic parameters is matched, GingerJS automatically parses the values from the URL and makes them available in your server script via the **`$g.request.params`** object.

**Example:**

-   **Route in `routes.json`:**
    ```json
    { "path": "/products/:productId/reviews/:reviewId", "script": "reviews/get.js" }
    ```
-   **Incoming Request URL:** `/my-app/products/abc-123/reviews/42`
-   **Server Script (`box/reviews/get.js`):**
    ```javascript
    module.exports = async function() {
        await ginger(async ($g) => {
            const productId = $g.request.params.productId; // "abc-123"
            const reviewId = $g.request.params.reviewId;   // "42"
            
            $g.response.send({
                message: `Fetching review ${reviewId} for product ${productId}.`
            });
        });
    };
    ```
