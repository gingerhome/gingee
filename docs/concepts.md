# Gingee: Core Concepts

Welcome to Gingee! This guide will introduce you to the fundamental concepts and the core philosophy behind the platform. Understanding these ideas will help you build powerful, secure, and scalable applications quickly.

## The Philosophy: Instant Time to Joy

Gingee is designed around a single guiding principle: **drastically reduce the time from an idea to a running, production-ready application.**

Traditional backend development involves dozens of small, time-consuming decisions and setup tasks: choosing a framework, setting up a server, configuring a database pool, managing CORS, structuring your project, and more. Gingee handles all of this for you. It's a "batteries-included" platform that lets you focus on your unique business logic from day one.

## 1. The Gingee Project Structure

A Gingee server has a simple, predictable folder structure. The key directories are:

-   **/web/**: This is the **web root**. Every first-level folder inside `web` is considered a distinct **App**.
-   **/web/my_app/**: The folder for an application named `my_app`.
    -   **/box/**: The **private brain** of your app. All your backend server scripts, private configuration, and private assets live here. Files in this folder are **never** served directly to the web.
    -   **/css/**, **/images/**, **/scripts/**: Publicly accessible folders for your static assets.
-   **/modules/**: The global "standard library" for Gingee. All the powerful modules like `db`, `crypto`, `fs`, and `image` live here.
-   **/gingee.json**: The main server configuration file.

## 2. The Flexible Routing Engine

Gingee features a powerful and flexible routing engine that automatically maps incoming URL requests to your server scripts or static files. It supports two distinct modes to fit your application's needs. The two modes can also be used together.

**NOTE:** In both modes, the url path should **NOT** have the /box/ explicitly mentioned. Gingee will handle it as required.

### Mode 1: File-Based Routing (Zero-Config Default)

For simplicity and rapid development, this is the default behavior. You don't need to configure anything—just create files.

-   **Server Scripts:** A request to a URL without a file extension is mapped to a JavaScript file inside the `box` folder.
    -   `GET /my-app/users/list` → executes `web/my-app/box/users/list.js`.
-   **Static Files:** A request to a URL *with* a file extension is mapped to a public file.
    -   `GET /my-app/css/style.css` → serves the file at `web/my-app/css/style.css`.

### Mode 2: Manifest-Based Routing (Powerful & Explicit)

For building RESTful APIs with clean, dynamic URLs, you can activate a more powerful routing mode by creating a **`routes.json`** file in your app's `box` folder.

-   **Dynamic Path Parameters:** This mode allows you to define routes with named parameters, which are automatically extracted and made available in your scripts.
    -   A route defined as `path: "/users/:userId/profile"` in `routes.json`...
    -   ...will match a request to `/my-app/users/123/profile`.
    -   ...and your script will receive the parameter `{ "userId": "123" }`.
-   **Explicit Mapping:** The `routes.json` file provides a clear, single source of truth for all of your application's endpoints, mapping them to specific server scripts and HTTP methods. When this file exists, it takes precedence over file-based routing.

**IMPORTANT:** The /box/ folder is never included in the url paths. Eg. a URL /<my-app>/api/my-script is automatically resolved by Gingee to /<my-app>/**box**/api/my-script . If the script exists, it is executed as a server script, if not Gingee will attempt to check for a folder of the same name in the path /<my-app>/api/my-script . If such a folder does not exist then a 404 is issued. If <app-name>/box/ appears in the URL a blanket 403 Access Denied is issued.

## 3. The Sandbox (`gbox`) & Secure Execution

**Security is not an afterthought in Gingee; it is the default.** Every server script you write is executed inside a secure sandbox called the "gbox".

-   **Isolation:** The sandbox prevents a script from accessing the server's global scope, filesystem, or sensitive process variables.
-   **Controlled Environment:** Instead of having dangerous access, your script is given a single, secure global object (`$g`) to interact with the world.
-   **ESM Support:** The sandbox automatically transpiles modern ES Module syntax (`import`/`from`) on the fly, so you can write modern JavaScript without any build steps.

## 4. The `gingee()` Middleware & the `$g` Global

This is the heart of the Gingee development experience. Every server script is wrapped in a call to the `gingee()` middleware, which prepares the environment and provides a powerful, simplified API.

```javascript
module.exports = async function() {
    await gingee(async ($g) => {
        // Your code goes here
        $g.response.send("Hello, World!");
    });
};
```

The `$g` object is your secure gateway to everything you need for a request, including the parsed request (`$g.request`), a response builder (`$g.response`), the logger (`$g.log`), and your app's configuration (`$g.app`).

## 5. The Module Ecosystem

Gingee provides a rich standard library of "app modules" to handle common tasks securely and efficiently. These are required by name (e.g., `require('db')`) from any server script.

-   **`auth`**: Provides authentication-related functions, including JWT creation and verification
-   **`cache`**: Provides a secure interface for caching data within the Gingee application context.
-   **`chart`**: Provides functionality to create and manipulate server-side charts
-   **`crypto`**: Provides an essential cryptographic toolkit.
-   **`dashboard`**: Provides functionality to create and manage a dashboard layout with multiple charts.
-   **`db`**: Provides a unified interface for database operations, allowing dynamic loading of different database adapters
-   **`encode`**: Provides various encoding and decoding utilities for strings, including Base64, URI, hexadecimal, HTML, and Base58.
-   **`fs`**: Provides secure, sandboxed synchronous and asynchronous file operations.
-   **`html`**: Provides functions for parsing and manipulating HTML from string, file and url sources.
-   **`httpclient`**: Provides functions to perform GET and POST requests, supporting various content types to simplify http calls
-   **`image`**: Provides a simple and secure way to manipulate images, including resizing, rotating, format conversion etc.
-   **`pdf`**: Provides functionality to create PDF documents, and includes a custom font registry system.
-   **`qrcode`**: Provides functions to generate QR codes and 1D barcodes.
-   **`utils`**: provides functions for generating random data, validating inputs, manipulating strings, and more.
-   **`uuid`**: Provides functions to generate and validate UUIDs (Universally Unique Identifiers).
-   **`zip`**: Provides functions to zip and unzip files and directories securely.

-   **`platform`**: Provides special Gingee platform level functions. To be used by only platform-level apps which are configured at server level (in gingee.json) as 'privileged apps'

**IMPORTANT**: All Gingee modules are required by name (eg. 'fs'). Some of these names intentionally are similar to NodeJS built-in modules for developer familiarity only. Gingee by default locks out access for all NodeJS built-in modules and third party modules with the exception of 'querystring', 'url' and 'mime-types'. A whitelist of built-in and third party modules can be configured in gingee.json but it is not recommended to do so to preserve the sandboxed nature of Gingee apps.

## 6. Configuration (`gingee.json`, `app.json`, etc.)

Configuration in Gingee is declarative and split across several manifest files, each with a clear purpose. This separation keeps server-level concerns apart from application-specific ones.

-   **`gingee.json`:** The master file for the entire server instance. It controls global settings like server ports, the central caching provider (Memory or Redis), and logging policies.
-   **`app.json`:** The manifest for a single application, located in its `box` folder. It defines the app's name, database connections, startup scripts, and middleware.
-   **`pmft.json`:** The security manifest for a distributable application. Here, a developer declares the permissions (e.g., `db`, `fs`) the app requires to function. The CLI reads this file to get consent from an administrator during installation.
-   **`routes.json`:** An optional manifest for enabling advanced, dynamic URL routing for an application, perfect for building clean RESTful APIs.

For a full breakdown, see the **[Server Config](./server-config.md)** and **[App Structure](./app-structure.md)** reference guides.

## 7. The Command Line Interface (CLI)

The `gingee-cli` is an essential, all-in-one tool for the entire application lifecycle. It is used for both local development and production server management. Its key capabilities include:

-   **Project Initialization:** Scaffolding a complete, new Gingee project with `gingee-cli init`.
-   **Local Scaffolding:** Quickly creating new apps and server scripts with `add-app` and `add-script`.
-   **Application Lifecycle:** Interactively installing (`install-app`), upgrading (`upgrade-app`), rolling back (`rollback-app`), and deleting applications on a remote server.
-   **App Store:** Discovering and installing apps from a decentralized store with `list-store-apps` and `install-store-app`.

For detailed usage of all commands, see the **CLI Command Reference** [MD](./gingee-cli.md) / [HTML](./gingee-cli.html).

## 8. A GenAI-Native Platform

Gingee is unique in its origin and development philosophy. It was co-authored by a human architect and a Generative AI partner, embracing a workflow we call "Dialog-Driven Development." High-level goals are discussed and refined in a collaborative dialogue, and the AI generates the implementation, which is then tested and validated.

You are encouraged to adopt this same powerful workflow. The key is to provide the AI with a "knowledge bundle" of the platform's architecture.

**How to Start an AI-Assisted App Development Session:**

1.  **Get the Context:** Locate the `ai-context.md` file in the project's `docs/ai-context` directory.
2.  **Prime the AI:** Begin a new session with a capable AI (like Google Gemini) by providing the entire contents of the context file with a simple instruction: "You are an expert developer for a platform called Gingee. Analyze the following documentation and API reference and be prepared to help me build an application."
3.  **Give it a Task:** Once the AI has processed the context, you can give it high-level, goal-oriented tasks, and it will generate high-quality, idiomatic Gingee code.
