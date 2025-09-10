# Gingee Expert Developer Context

You are an expert developer for a Node.js application server called Gingee. Your goal is to help users build applications on this platform by exclusively using the following concepts and API reference. Always write server scripts in the required `module.exports = async function() { await gingee(async ($g) => { ... }) }` format.

---


# Gingee: Core Concepts

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


---


# Gingee CLI: Command Reference

# Gingee CLI: Command Reference

The `gingee-cli` is the official, all-in-one command-line interface for the Gingee platform. It is a powerful tool for both developers and system administrators, designed to streamline every phase of the application lifecycle, from initial project creation to ongoing production management.

## Installation

The `gingee-cli` is designed to be installed globally on your machine, making it available everywhere.

```bash
npm install -g gingee-cli
```
After installation, you will have access to the `gingee-cli` command in your terminal.

---

## Commands

### Project Initialization

This is the main entry point for starting a new Gingee project.

#### `init <project-name>`

Scaffolds a complete, new Gingee project in a new directory. It launches an interactive wizard to guide you through the setup.

**Usage:**
```bash
gingee-cli init my-awesome-project
```

**Wizard Prompts:**
-   `Administrator Username for glade:` Sets the initial username for the bundled Glade admin panel. Defaults to `admin`.
-   `Administrator Password for glade:` Securely prompts for the admin password. This is hashed and stored in Glade's configuration.
-   `Install npm dependencies automatically?` If yes (default), it will run `npm install` so the project is ready to run immediately.

---

### Local Scaffolding

These commands should be run from the root directory of an existing Gingee project.

#### `add-app <app-name>`

Scaffolds a new, working "hello world" application inside your project's `web` directory.

**Usage:**
```bash
gingee-cli add-app my-blog
```

**Wizard Prompts:**
-   `What type of app is this?` Choose between `MPA` (Multi-Page App, default) or `SPA` (Single Page Application, for React/Vue/Angular).
-   `Would you like to configure a database connection?` If yes, it will guide you through setting up the `db` block in the new app's `app.json`.
-   `Generate a JWT secret for this app?` If yes, it will automatically generate a secure secret and add it to `app.json`.

#### `add-script <app-name> <script-path>`

Quickly creates a new server script file, pre-populated with the standard Gingee boilerplate.

**Usage:**
```bash
gingee-cli add-script my-blog api/posts
```
Creates ./web/my-blog/box/api/posts.js

---

### Server Administration

These commands interact with the API of a live, running `glade` instance. They require you to be authenticated via the `login` command.

#### `login [server-url]`

Authenticates the CLI with a Glade admin panel and saves the session for subsequent commands.

**Usage:**
-  Login to a local server
```bash
gingee-cli login
```

-  Login to a remote server
```bash
gingee-cli login -s http://remote-gingee:7070
```

**Options:**
-   `-s, --serverUrl <server-url>`: The target Gingee server URL. Defaults to `http://localhost:7070`.
-   `-u, --username <username>`: Provide the username non-interactively. Defaults to `admin`.
-   `-p, --password <password>`: Provide the password non-interactively. If this option is omitted, you will be securely prompted to enter a password.

#### `logout [server-url]`

Logs out of a specific Glade session by deleting the stored credentials.

**Usage:**
```bash
gingee-cli logout -s http://remote-gingee:7070
```

**Options:**
-   `-s, --serverUrl <server-url>`: The target Gingee server URL. Defaults to `http://localhost:7070`

#### `list-apps`

Lists all applications installed on the target server.

**Usage:**
```bash
gingee-cli list-apps -s https://remote-gingee:7070
```

**Options:**
-   `-s, --server <url>` (Optional): The base URL of the target Gingee server. Defaults to `http://localhost:7070`.

---

### App Store Commands

These commands allow you to discover and install applications from a decentralized "app store," which is simply a server hosting a `store.json` manifest file.

#### `list-store-apps`

Fetches the manifest from a store URL and displays a list of available applications.

**Usage:**
```bash
gingee-cli list-store-apps -g https://my-store.example.com
```

**Options:**
-   `-g, --gStoreUrl <gstore-url>` (Optional): The Gingee App Store url

#### `install-store-app <app-name>`

Initiates an interactive installation of an application from a store. The CLI will:
1.  Download the app's `.gin` package.
2.  Read the app's required permissions from its internal `pmft.json` manifest.
3.  Prompt you for consent to grant these permissions.
4.  Prompt you to configure any requirements (like database connections).
5.  Repackage the app with your configuration and securely install it on your target Gingee server.

**Usage:**
```bash
gingee-cli install-store-app my-blog-app -g https://my-store.example.com  -s http://<remote-gingee>
```

**Options:**
-   `-g, --gStoreUrl <gstore-url>` (Optional): The Gingee App Store url
-   `-s, --server <url>` (Optional): The base URL of the target Gingee server. Defaults to `http://localhost:7070`

#### `upgrade-store-app <app-name>`

Initiates an interactive installation of an application from a store. The CLI will:
1.  Download the app's `.gin` package.
2.  Read the app's required permissions from its internal `pmft.json` manifest.
3.  Create the new set of permissions that are requested. (auto assigns previous version grants)
4.  Prompt you for consent to grant these permissions.
5.  Prompt you to configure any requirements (like database connections).
6.  Repackage the app with your configuration and securely install it on your target Gingee server.

**Usage:**
```bash
gingee-cli install-store-app my-blog-app -g https://my-store.example.com  -s http://<remote-gingee>
```

**Options:**
-   `-g, --gStoreUrl <gstore-url>` (Optional): The Gingee App Store url
-   `-s, --server <url>` (Optional): The base URL of the target Gingee server. Defaults to `http://localhost:7070`

---

### Application Lifecycle Management

These powerful commands allow for remote deployment and management of your applications.

| Command | Description |
| :--- | :--- |
| **`package-app`** | Packages a live application from the server into a distributable `.gin` archive file. |
| **`install-app`** | Installs a new application onto a server from a local `.gin` package file. |
| **`upgrade-app`** | Upgrades an existing application on a server using a new `.gin` package file. |
| **`delete-app`** | Permanently deletes an application and all its content from the server. |

**Common Options for Lifecycle Commands:**
-   `-s, --server <url>` (Optional): The URL of the target server. Defaults to the last-logged-in server.
-   `-a, --appName <app-name>` (Required): The name of the target application.
-   `-p, --ginPath <path>` (Required for install/upgrade): The path to the local `.gin` package file.
-   `-f, --file <path>` (Automation): Provide a preset file for non-interactive execution.

**Example Usage:**
```bash
# Upgrade the 'my-blog' app on a production server
gingee-cli upgrade-app --appName my-blog --ginPath ./builds/my-blog-v2.gin --server https://prod.server
```

---

### Backup & Recovery

Commands for the disaster recovery and rollback features.

| Command | Description |
| :--- | :--- |
| **`list-app-backups`** | Lists all available `.gin` backup files for an application stored on the server. |
| **`rollback-app`** | Rolls an application back to its most recently created backup on the server. |

**Common Options for Recovery Commands:**
-   `-s, --server <url>` (Optional): The URL of the target server.
-   `-a, --appName <app-name>` (Required): The name of the target application.
-   `-f, --file <path>` (Automation): Provide a preset file for non-interactive execution.

---

### **Automation with Preset Files**

For use in CI/CD pipelines or other automated scripts, the lifecycle commands (`install-app`, `upgrade-app`, `rollback-app`, `delete-app`) can be run in a non-interactive mode by providing a preset file using the `-f, --file <path>` option.

The preset file is a simple JSON file that contains the configuration for the action you want to perform. The CLI will use the values from this file instead of showing interactive prompts.

**Example `myapp-deploy-presets.json`:**
```json
{
  "upgrade": {
    "ginPath": "./build/my-blog-app-v2.gin",
    "consent": {
      "grantPermissions": ["db", "fs", "httpclient"]
    },
    "config": {
      "db": [
        {
          "name": "main_db",
          "host": "prod-db.cluster.internal",
          "user": "prod_user",
          "password": "$DB_PASSWORD_PROD",
          "database": "blog_production"
        }
      ]
    }
  },
  "rollback": {
    "consent": {
      "grantPermissions": ["db", "fs"]
    }
  },
  "delete": {
    "confirm": true
  }
}
```

**Security with Environment Variables:**
For sensitive values like passwords, you can use environment variable placeholders (a string starting with `$`). The CLI will automatically substitute `$VAR_NAME` with the value of the `process.env.VAR_NAME` variable at runtime.

**Example Usage in a CI/CD script:**
```bash
# The server URL and app name are still passed as arguments for safety
export DB_PASSWORD_PROD="a-very-secret-password"
gingee-cli upgrade-app --appName my-blog-app --serverUrl https://prod.server --file ./deploy.json
```
---

### Service Management

Commands for running Gingee as a native background service. These commands must be run from a project's root directory and typically require `sudo` or Administrator privileges.

-   **`service install`**: Installs and starts the server as a background service.
-   **`service uninstall`**: Stops and removes the background service.
-   **`service start`**: Manually starts the installed service.
-   **`service stop`**: Manually stops the installed service.

---

### Local Utilities

-   **`reset-pwd`**: A local recovery tool. Prompts for a new admin user password for `glade` admin panel.
-   **`reset-glade`**: A local recovery tool that performs a clean re-installation or reset of the `glade` admin panel.


---


# Server Configuration Reference - The gingee.json File

# Server Configuration Reference - The gingee.json File

The `gingee.json` file is the master configuration file for the entire Gingee server instance. It resides in the root of your project and controls server behavior, caching policies, logging, and security settings that apply to all applications running on the platform.

Here is a comprehensive breakdown of all available properties.

```json
{
  "server": {
    "http": { "enabled": true, "port": 7070 },
    "https": { 
      "enabled": false, 
      "port": 7443,
      "key_file": "./settings/ssl/key.pem",
      "cert_file": "./settings/ssl/cert.pem"
    }
  },
  "web_root": "./web",
  "default_app": "glade",
  "cache": {
    "provider": "memory",
    "prefix": "gingee:",
    "redis": {
      "host": "127.0.0.1",
      "port": 6379,
      "password": null
    }
  },
  "max_body_size": "10mb",
  "content_encoding": { "enabled": true },
  "logging": {
    "level": "info",
    "rotation": {
      "period_days": 7,
      "max_size_mb": 50
    }
  },
  "box": {
    "allowed_modules": []
  },
  "privileged_apps": []
}
```

### server

An object that configures the HTTP and HTTPS servers.

- **`server.http`** (object)
  - **`enabled`** (boolean): Set to `true` to enable the HTTP server. Default: true. 
  - **`port`** (number): The port number for the HTTP server to listen on. Default: 7070.

- **`server.https`** (object)
  - **`enabled`** (boolean): Set to `true` to enable the HTTPS server. Default: false. 
  - **`port`** (number): The port number for the HTTPS server to listen on. Default: 7443. 
  - **`key_file`** (string): The path to the SSL private key file (e.g., `key.pem`). Can be relative to the project root or an absolute path. Default: `"./settings/ssl/key.pem"`.
  - **`cert_file`** (string): The path to the SSL certificate file (e.g., `cert.pem`). Can be relative to the project root or an absolute path. Default: `"./settings/ssl/cert.pem"`
  - **NOTE:** See `Enabling HTTPS` section below to configure and run a HTTPS enabled Gingee

### web_root

- **Type:** `string`
- **Default:** `"./web"`
- **Description:** The path to the directory containing all your application folders. This can be a relative path (from the project root) or an absolute path. Gingee will fail to start if this directory does not exist.
- **Example (relative):** `"web_root": "./public"`
- **Example (absolute):** `"web_root": "/var/www/gingee_apps"`

### cache

- **Type:** `object`
- **Description:** Configures the server-wide, centralized caching provider. This cache is used for internal server tasks (like static file caching). Once configured, the same cache is also made available to applications via the `cache` module to cache app data.

- **`cache.provider`** (string):

  - **Default:** `"memory"`
  - **Description:** Specifies which cache backend to use.
  - **Values:**
    - `"memory"`: Uses a fast, dependency-free, in-process memory cache. Perfect for local development or single-node deployments. This cache is cleared on every server restart.
    - `"redis"`: Uses an external Redis server, enabling a shared, distributed cache for multi-node, horizontally-scaled deployments.

- **`cache.prefix`** (string, optional):

  - **Description:** A global prefix that will be prepended to all cache keys. This is highly recommended when using a shared Redis instance to prevent key collisions with other applications.
  - **Example:** `"prefix": "my-prod-gingee:"`

- **`cache.redis`** (object, optional):
  - **Description:** Contains the connection details, used only when `provider` is set to `"redis"`.
  - **`host`** (string): The hostname or IP address of your Redis server.
  - **`port`** (number): The port of your Redis server.
  - **`password`** (string | null): The password for your Redis server, or `null` if none is set.

### max_body_size
- **Type:** `string`
- **Description:** Configures the maximum allowed HTTP request body size. Defaults to '10mb'. Interprets human readable string such as `mb`, `gb`.

### content_encoding

- **Type:** `object`
- **Description:** Configures Gzip compression for responses.
- **`enabled`** (boolean): If `true`, Gingee will compress applicable responses (like HTML, CSS, JS, and JSON) if the client's browser indicates support for it via the `Accept-Encoding` header. This significantly reduces bandwidth usage.

### logging

An object that configures the server's logger.

- **`level`** (string): The minimum level of messages to log. Standard levels are `"error"`, `"warn"`, `"info"`, `"verbose"`, `"debug"`.
- **`rotation`** (object): Configures log file rotation to prevent log files from growing infinitely.
  - **`period_days`** (number): The maximum number of days to keep a log file before creating a new one.
  - **`max_size_mb`** (number): The maximum size in megabytes a log file can reach before a new one is created.

### box (Sandbox Configuration)

- **Type:** `object`
- **Description:** Configures the security settings for the `gbox` sandbox environment.
- **`allowed_modules`** (array of strings): A whitelist of Node.js built-in modules that sandboxed scripts are allowed to `require()`. Any module not on this list (e.g., `fs`, `child_process`) cannot be accessed. **Ideally you will never need to set this property**
- **Example:** `["url", "querystring"]`

### default_app

-   **Type:** `string`
-   **Default:** `"glade"`
-   **Description:** Specifies the `<app-name>` of the application that should handle requests to the server's root URL (`/`). When a user navigates to your server's base address, they will be transparently routed to this application.
-   **Example:** `"default_app": "my-main-website"`

### privileged_apps

- **Type:** `array of strings`
- **Description:** A list of `<app-name>`s (the folder names in your `web_root`) that are granted special privileges.
- **Privilege:** Only applications listed here are allowed to `require('platform')`, the powerful module used for application lifecycle management (creating, deleting, packaging apps, etc.). This is a critical security boundary. They can also access any Node JS built in module or third party NodeJS modules that are default included in by Gingee (see package.json). **Ideally you will never need to set this property**
- **Example:** `["admin"]`

---

## Enabling HTTPS for Local Development

To run and test your Gingee server with a valid SSL certificate on `localhost` (i.e., get the green padlock in your browser), you cannot use a simple self-signed certificate, as browsers do not trust them. The correct method is to create your own local Certificate Authority (CA) and use it to sign a certificate for `localhost`.

**Prerequisites:**
You must have the `openssl` command-line tool installed. It is available by default on Linux and macOS. For Windows, it is included with Git Bash.

**Step 1: Create Your Local Certificate Authority**

First, we create a private key and a root certificate for our new local CA. Run these commands from your project root.

1.  Generate the CA's private key:
    ```bash
    openssl genrsa -out ./settings/ssl/localCA.key 2048
    ```
2.  Generate the CA's root certificate. You will be prompted for details like country and organization; you can enter any information you like.
    ```bash
    openssl req -x509 -new -nodes -key ./settings/ssl/localCA.key -sha256 -days 1024 -out ./settings/ssl/localCA.pem
    ```

**Step 2: Add the CA to Your System's Trust Store**

This is the critical step where you tell your operating system to trust your new local CA.

*   **On macOS:**
    1.  Double-click the `localCA.pem` file in Finder to open the Keychain Access app.
    2.  Find the certificate (it will have the "Common Name" you entered). Double-click it.
    3.  Expand the "Trust" section. For "When using this certificate," select **"Always Trust"**.
    4.  Close the window and enter your system password when prompted.

*   **On Windows:**
    1.  Double-click the `localCA.pem` file.
    2.  Click "Install Certificate...".
    3.  Select store location: "Current User", then click Next.
    4.  Select "Place all certificates in the following store," click "Browse," and choose **"Trusted Root Certification Authorities"**. Click OK.
    5.  Click Next and Finish, accepting any security warnings.

*   **On Linux (Ubuntu/Debian):**
    ```bash
    sudo cp ./settings/ssl/localCA.pem /usr/local/share/ca-certificates/localCA.crt
    sudo update-ca-certificates
    ```

**Step 3: Create and Sign the Server Certificate**

Now, create the `key.pem` and `cert.pem` files that Gingee will use, and sign them with your trusted local CA.

1.  Generate the server's private key:
    ```bash
    openssl genrsa -out ./settings/ssl/key.pem 2048
    ```
2.  Create a Certificate Signing Request (CSR). **Important:** When prompted for the "Common Name (CN)," you **must** enter `localhost`.
    ```bash
    openssl req -new -key ./settings/ssl/key.pem -out ./settings/ssl/server.csr
    ```
3.  Sign the server certificate with your local CA:
    ```bash
    openssl x509 -req -in ./settings/ssl/server.csr -CA ./settings/ssl/localCA.pem -CAkey ./settings/ssl/localCA.key -CAcreateserial -out ./settings/ssl/cert.pem -days 500 -sha256
    ```

**Step 4: Update `gingee.json` and Run**

Enable the HTTPS server in your configuration. Since we used the default file paths, you don't need to add the `key_file` or `cert_file` properties.

```json
{
  "server": {
    "http": { "enabled": false },
    "https": { "enabled": true, "port": 7443 }
  }
}
```

Now, start your server (`npm start`). You can navigate to `https://localhost:7443` and your browser will show a secure connection with no warnings.


---


# 


# Glade: The Gingee Admin Panel

Glade is the official, web-based administration panel that is bundled with every Gingee server. It provides a simple, secure, and powerful user interface for managing the entire lifecycle of all applications running on your server instance.

Glade is itself a Gingee application, built to showcase the platform's capabilities. It is a **privileged app**, meaning it has special permission to use the powerful `platform` module to perform its administrative tasks.

## First-Time Access & Login

When you create a new Gingee project using the `gingee-cli init` command, the Glade application is automatically installed and configured for you.

1.  **Initial Credentials:** During the `init` wizard, you are prompted for an administrator username and password. The CLI securely hashes the password using Argon2 and stores these credentials inside Glade's configuration file.

2.  **Configuration File:** The credentials are saved in `web/glade/box/app.json`:
    ```json
    // web/glade/box/app.json
    {
      "name": "glade",
      // ...
      "env": {
        "ADMIN_USERNAME": "admin",
        "ADMIN_PASSWORD_HASH": "$argon2id$v=19$m=..." 
      }
    }
    ```

3.  **Accessing Glade:** By default, Gingee is configured to make Glade the `default_app`. To access it, simply navigate your browser to the root URL of your running server (e.g., `http://localhost:7070`). You will be automatically directed to the Glade login page.

## The Dashboard View

After a successful login, you are taken to the main Glade dashboard. This is your central hub for viewing and managing all applications.

**Login**
![Glade Login](./images/1.glade-login.png)

**Dashboard**
![Glade Dashboard UI](./images/2.glade-dashboard.png)

The dashboard consists of two main components:

1.  **The Header:** Contains the Glade title and a **Logout** button to securely end your session.
2.  **The Application List:** A table that displays every application currently installed and running on the Gingee server.
    -   **App Name:** The unique ID of the application (corresponds to its folder name in `web/`).
    -   **Version:** The version number, as specified in the app's own `app.json` file.
    -   **Actions:** A set of buttons for performing lifecycle operations on each application.

## Core Features: Application Lifecycle Management

All major application management tasks can be performed directly from the Glade UI.

### Installing a New Application

This is for deploying a new application from a package file. Glade provides an intelligent, multi-step wizard to ensure applications are installed securely and correctly.

1.  Click the green **Install** button at the top of the application list.
2.  A modal dialog will appear, prompting for the **Application Name** and the **App Package File (.gin)**.
3.  Upon selecting a `.gin` file, Glade analyzes the package *in your browser* and transforms the modal into a tabbed installation wizard.
4.  **Permissions Tab:** The first tab will display the `mandatory` and `optional` permissions the application requires (read from its `pmft.json` manifest). You must review and consent to these permissions before proceeding.
5.  **Configuration Tab:** If the application requires any database connections, this tab will display a form for you to enter the connection details (host, user, password, etc.). For apps with multiple database requirements, this will be displayed as a convenient accordion.
6.  **Confirm Tab:** A final tab shows a summary of the installation.
7.  Clicking **Confirm & Install** securely repackages the application with your provided database configuration and installs it on the server with only the permissions you explicitly granted. The application list will then automatically refresh.

**Upload App Package(.gin) File**
![Install App - Package Upload](./images/3.glade-install-app.png)

**Grant Permissions**
![Install App - Grant Permissions](./images/3.glade-install-app-2.png)

**Configure App**
![Install App - Configure App](./images/3.glade-install-app-3.png)

**Confirm Install**
![Install App - Confirm Install](./images/3.glade-install-app-4.png)

### Managing App Permissions

Security is managed at the application level. You can review and change the permissions for any installed app at any time.

1.  In the application list, find the app you wish to configure and click its gray **Permissions** button.
2.  A modal dialog will appear, listing all available permissions in the Gingee platform.
3.  Checkboxes will indicate the permissions currently granted to the app.
4.  You can grant or revoke permissions by toggling the checkboxes.
5.  Click **Save**. Glade will securely update the server's central permissions file and then automatically trigger a safe reload of the application to ensure the new rules are applied immediately.

![Glade App Permissions](./images/6.glade-app-permissions.png)

### Upgrading an Application

This is for deploying a new version of an *existing* application. The process is nearly identical to a new installation, ensuring the same level of security and configuration.

1.  In the application list, find the app you wish to upgrade and click its blue **Upgrade** button.
2.  The installation wizard will appear, but the "Application Name" field will be pre-filled and read-only.
3.  After you select the new `.gin` package file, the wizard will analyze it and guide you through the same **Permissions** and **Configuration** tabs, allowing you to approve any new permissions the upgraded version requires.
4.  Glade will perform a secure, data-aware upgrade, creating a backup of the previous version before replacing the application's code.

**Upload App Package(.gin) File**
![Upgrade App - Package Upload](./images/4.glade-upgrade-app.png)

**Grant Permissions**
![Install App - Grant Permissions](./images/4.glade-upgrade-app-2.png)

**Configure App**
![Install App - Configure App](./images/4.glade-upgrade-app-3.png)

**Confirm Upgrade**
![Install App - Confirm Upgrade](./images/4.glade-upgrade-app-4.png)

### Packaging an Application (Download)

This allows you to create a distributable `.gin` package from a live, running application.

1.  In the application list, find the app you want to package.
2.  Click its **Download** button.
3.  Your browser will immediately begin downloading a `<app-name>.gin` file. This file can be used to install the application on another Gingee server or for backup purposes.

### Rolling Back an Application

If a recent upgrade has caused issues, you can quickly and safely revert to the previous version.

1.  In the application list, find the app you wish to roll back.
2.  Click its yellow **Rollback** button.
3.  A confirmation modal will appear. Glade first analyzes the latest backup and presents a clear "diff," showing you which permissions will be granted or revoked if you proceed with the rollback.
4.  After you approve any permission changes, click the **Confirm** button. Glade will perform a safe, data-preserving rollback to the most recent backup of that application and apply the correct set of permissions.

![Glade App Rollback](./images/5.glade-rollback-app.png)

### Uninstalling an Application

This is a destructive action that will permanently remove an application and all of its associated configuration and content.

1.  In the application list, find the app you wish to uninstall.
2.  Click its red **Uninstall** button.
3.  A confirmation modal will appear, asking you to type the application's name to confirm this irreversible action.
4.  Click the **Confirm** button. Glade will gracefully shut down the application's services, revoke its permissions, clear its caches, and delete its entire directory from the server.

![Glade App Delete](./images/7.glade-app-delete.png)

## Administration & Security

### Logging Out

To securely end your administrative session, simply click the **Logout** button in the top-right corner of the header. This will delete your session on the server and clear the authentication cookie from your browser.

### Resetting the Admin Password

If you forget your Glade password, you cannot recover it. However, if you have command-line access to the server where Gingee is running, you can securely reset it.

1.  Navigate to the root of your Gingee project directory in the terminal.
2.  Run the following command from the `gingee-cli`:
    ```bash
    gingee-cli reset-pwd
    ```
3.  The tool will prompt you to enter and confirm a new password.
4.  It will then generate a new, secure password hash.
5.  Copy this entire hash and paste it into your `web/glade/box/app.json` file, replacing the old value for the `ADMIN_PASSWORD_HASH` key.
6.  Restart your Gingee server. You will now be able to log in with your new password.


---


# Anatomy of a Gingee App

# Anatomy of a Gingee App

Every application built on Gingee follows a simple and consistent structure. This guide breaks down that structure, explains the critical role of the `box` folder, and provides a comprehensive reference for all the settings available in the `app.json` and `routes.json` configuration file.

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

- **`css/`, `images/`, `scripts/`, etc.:** These are **public** directories. Any file placed here can be accessed directly by its URL. Gingee's static file server will serve these assets. For example, a file at `web/my_app/css/style.css` is available at `/my_app/css/style.css`.

- **`index.html`**: If a user navigates to the app's root URL (`/my_app`), this file will be served by default (if the app is not an SPA).

### The Importance of the `box` Folder

The `box` folder is the **private, secure core** of your application. It contains all your backend logic, configuration, and private data.

- **Security:** The `box` folder is **always protected**. No file inside the `box` can ever be accessed directly from a URL. A request to `/my_app/box/app.json`, for example, will be blocked with a `403 Access Denied` error. This is a fundamental security guarantee of the Gingee platform.

- **Server Scripts:** All your backend API endpoints are JavaScript files that live inside the `box`. A request to `/my_app/api/users` is mapped to the file at `web/my_app/box/api/users.js`.

- **Configuration:** All app-specific configuration, including the crucial `app.json` file, resides in the `box`.

- **Private Data:** If your application uses a file-based database like SQLite, its database file should be stored in a subdirectory within the `box` (e.g., `box/data/app.db`) to ensure it is protected from direct web access.

---

## The `app.json` File:

The `app.json` file, located at `web/my_app/box/app.json`, is the central configuration file for your application. It tells the Gingee server how to handle the app, what resources it needs, and how it should behave.

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

If you plan to distribute your application as a `.gin` package, you must declare the permissions it requires in a `pmft.json` file. This manifest is read by the `gingee-cli` during the installation process to request consent from the server administrator.

-   **Location:** `web/<your-app-name>/box/pmft.json`
-   **Purpose:** To declare your app's required (`mandatory`) and optional (`optional`) permissions.

For a complete guide on the permissions system and the structure of this file, please see the **Gingee Permissions Guide [MD](./permissions-guide.md) [HTML](./permissions-guide.html)**.

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

When a route with dynamic parameters is matched, Gingee automatically parses the values from the URL and makes them available in your server script via the **`$g.request.params`** object.

**Example:**

-   **Route in `routes.json`:**
    ```json
    { "path": "/products/:productId/reviews/:reviewId", "script": "reviews/get.js" }
    ```
-   **Incoming Request URL:** `/my-app/products/abc-123/reviews/42`
-   **Server Script (`box/reviews/get.js`):**
    ```javascript
    module.exports = async function() {
        await gingee(async ($g) => {
            const productId = $g.request.params.productId; // "abc-123"
            const reviewId = $g.request.params.reviewId;   // "42"
            
            $g.response.send({
                message: `Fetching review ${reviewId} for product ${productId}.`
            });
        });
    };
    ```


---


# Understanding Gingee Scripts

# Understanding Gingee Scripts

Gingee executes your backend logic using JavaScript files that live inside your app's secure `box` folder. For consistency and ease of use, all executable scripts—whether they are handling a live API request, acting as middleware, or performing a one-time setup task—share the same fundamental structure. This guide explains the three types of scripts and the powerful `$g` object that connects them.

## The Consistent Script Pattern

All Gingee scripts, regardless of their purpose, follow this simple and mandatory pattern:

```javascript
// A script must export a single asynchronous function.
module.exports = async function() {

    // The entire logic is wrapped in a call to the global 'gingee()' function.
    await gingee(async function($g) {

        // Your application code goes here.
        // You use the '$g' object to interact with the world.
        
    });
};
```
This unified structure ensures that every piece of executable code runs within the same secure, sandboxed environment and receives a properly configured context object (`$g`).

## Types of Scripts in Gingee

While the structure is the same, the purpose of a script and the context it runs in can differ. There are three types of scripts you can create.

### 1. Server Scripts (API Endpoints)

This is the most common type of script. It runs in direct response to an incoming HTTP request from a browser or client.

-   **Purpose:** To handle API requests (e.g., fetching data, creating a user, processing a form).
-   **Execution:** Triggered by the Gingee routing engine when a URL matches either a file path or a route defined in `routes.json`.
-   **`$g` Context:** Has access to the **full** `$g` object, including:
    *   `$g.request`: To get headers, query parameters, and the request body.
    *   `$g.response`: To send a response back to the client.
    *   `$g.log` and `$g.app`.

**Example (`box/api/users/get.js`):**
```javascript
module.exports = async function() {
    await gingee(async ($g) => {
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
    await gingee(async ($g) => {
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
-   **Execution:** Configured in `app.json` via the `"startup-scripts"` array. They run in the order they are listed when the Gingee server starts, when an app is newly installed, or after an app is upgraded or rolled back.
-   **`$g` Context:** Receives a **specialized, non-HTTP** version of the `$g` object.
    *   **Available:** `$g.log`, `$g.app`.
    *   **NOT Available:** `$g.request` and `$g.response` are `null`, as there is no incoming request or outgoing response.
    *   **Important:** If a startup script throws an error, it is considered a fatal initialization failure, and the entire Gingee server will shut down to prevent it from running in an unstable state.

**Example (`box/setup/create_schema.js`):**
```javascript
module.exports = async function() {
    await gingee(async ($g) => {
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
    -   **Description:** The pre-parsed body of the request. The `gingee()` middleware automatically parses the body based on the `Content-Type` header.
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


---


# Gingee: The App Developer's Guide

# Gingee: The App Developer's Guide

Welcome to Gingee! This guide is your starting point for building powerful, secure, and modern applications on the Gingee platform. We'll take you from a simple "Hello World" to a complete, database-backed RESTful API.

If you haven't already, please read the Core Concepts [MD](./concepts.md) [HTML](./concepts.html) guide for a high-level overview of the platform's architecture.

## Chapter 1: Your First App - Hello World

The fastest way to get started is with the `gingee-cli`. After you've created your first project with `gingee-cli init my-project`, you can create your first application.

```bash
cd my-project
gingee-cli add-app first-app
```

The CLI will scaffold a new, working application in the `web/first-app/` directory. Let's look at the three most important files it created:

1.  **`web/first-app/index.html`**: The main HTML page.
2.  **`web/first-app/scripts/cl_app.js`**: The client-side JavaScript for the `index.html` page.
3.  **`web/first-app/box/hello.js`**: A server-side script.

Run your server with `npm run dev` and navigate to `http://localhost:7070/first-app`. You'll see the page and an interactive "Say Hello" button. This works because of Gingee's **File-Based Routing**:

-   The request for the page (`/first-app`) serves the static `index.html`.
-   The button's click handler in `cl_app.js` makes a `fetch` call to `/first-app/hello`.
-   Because this URL has no file extension, Gingee automatically executes the server script at `web/first-app/box/hello.js`.

## Chapter 2: The Server Script & the `$g` Global

Let's look inside `web/first-app/box/hello.js`. All Gingee server scripts follow this simple structure:

```javascript
module.exports = async function() {
    await gingee(async ($g) => {
        // Your application logic lives here!
        $g.response.send({ message: 'Hello from the first-app server script!' });
    });
};
```

-   **`module.exports`**: Each script is a standard Node.js module that exports a single `async` function.
-   **`await gingee(handler)`**: This globally available function is the heart of the system. It wraps your logic, providing security and automatically handling complex tasks like parsing the request body. You should always `await` it.
-   **`$g`**: The single, powerful "global" object passed to your handler. It's your secure gateway to everything you need.

Let's modify the script to take a query parameter:

```javascript
// in web/first-app/box/hello.js
await gingee(async ($g) => {
    const name = $g.request.query.name || 'World';
    $g.response.send({ message: `Hello, ${name}!` });
});
```

Now, navigate to `/first-app/hello?name=Gingee` and you'll see the personalized response. All query parameters are automatically parsed for you in `$g.request.query`.

*For a full breakdown of all properties on `$g`, see the Server Script & $g Object Reference [MD](./server-script.md) [HTML](./server-script.html)*

## Chapter 3: Building a RESTful API with `routes.json`

While file-based routing is great for simple pages, a real API needs clean, dynamic URLs (e.g., `/posts/123`). For this, we use manifest-based routing.

1.  Create a file at `web/first-app/box/routes.json`.
2.  Define your application's routes in this file.

**`web/first-app/box/routes.json`**
```json
{
  "routes": [
    {
      "path": "/posts",
      "method": "POST",
      "script": "api/posts/create.js"
    },
    {
      "path": "/posts/:postId",
      "method": "GET",
      "script": "api/posts/get.js"
    }
  ]
}
```

Now, a `POST` request to `/first-app/posts` will execute `box/api/posts/create.js`. A `GET` request to `/first-app/posts/abc-123` will execute `box/api/posts/get.js`.

In your script, you can access the dynamic `:postId` parameter via `$g.request.params`.

**`web/first-app/box/api/posts/get.js`**
```javascript
module.exports = async function() {
    await gingee(async ($g) => {
        const postId = $g.request.params.postId; // "abc-123"
        
        // ... logic to fetch post from database ...

        $g.response.send({ id: postId, title: 'My First Post' });
    });
};
```

## Chapter 4: Connecting to the Database

Gingee makes database interaction simple and secure.

1.  **Configure:** First, run `gingee-cli add-app my-blog` and follow the wizard to configure your database. This will populate the `db` section of your `web/my-blog/box/app.json`.
2.  **Query:** Use the powerful, sandboxed `db` module in your scripts.

**`web/my-blog/box/api/posts/get.js` (with DB logic)**
```javascript
module.exports = async function() {
    await gingee(async ($g) => {
        const db = require('db');
        const postId = $g.request.params.postId;
        const DB_NAME = 'main_db'; // The 'name' from your app.json

        try {
            const sql = 'SELECT * FROM "Posts" WHERE "id" = $1';
            const post = await db.query.one(DB_NAME, sql, [postId]);

            if (post) {
                $g.response.send(post);
            } else {
                $g.response.send({ error: 'Post not found' }, 404);
            }
        } catch (err) {
            $g.log.error('Failed to fetch post', { postId, error: err.message });
            $g.response.send({ error: 'Internal Server Error' }, 500);
        }
    });
};
```

-   **`db.query.one`**: Fetches a single record.
-   **`db.query.many`**: Fetches an array of records.
-   **`db.execute`**: Use for `INSERT`, `UPDATE`, and `DELETE`. Returns the number of rows affected.
-   **Security:** Always use parameters (`$1`, `$2`) to prevent SQL injection. The `db` module handles this securely.

## Chapter 5: Using the Standard Library (App Modules)

Let's secure our `POST /posts` endpoint and validate its input.

1.  **Create an Auth Middleware:** Create `web/my-blog/box/auth_middleware.js`.
    ```javascript
    module.exports = async function() {
        await gingee(async ($g) => {
            const auth = require('auth');
            const token = $g.request.headers.authorization?.split(' ')[1];
            const payload = auth.jwt.verify(token);

            if (!payload) {
                // This call ends the request and prevents the main handler from running.
                $g.response.send({ error: 'Unauthorized' }, 401);
            }
        });
    };
    ```
2.  **Enable the Middleware:** In `web/my-blog/box/app.json`, add it to the `default_include` array. Now it will run before every script in your app.
    ```json
    "default_include": ["auth_middleware.js"]
    ```
3.  **Validate Input:** In your `create.js` script, use the `utils` module.
    **`web/my-blog/box/api/posts/create.js`**
    ```javascript
    module.exports = async function() {
        await gingee(async ($g) => {
            const { validate } = require('utils');
            const { title, content } = $g.request.body;

            if (validate.isEmpty(title)) {
                return $g.response.send({ error: 'Title is required.' }, 400);
            }
            // ... insert into database ...
        });
    };
    ```

## Chapter 6: A New Paradigm - Building with a GenAI Partner

Gingee was co-authored with a Generative AI, and you can leverage this same powerful workflow to build your own applications. The key is to provide the AI with a "knowledge bundle" of the platform's architecture. We've created this for you.

**How to Start a Development Session with an AI:**

1.  **Get the Context File:** Locate the pre-built `docs/ai-context.md` file in the Gingee repo. This file contains all the core concepts and API references of Gingee that an AI needs.

2.  **Start a New Chat:** Open a new session with a capable coding AI partner (like Google Gemini).

3.  **Use the Priming Prompt:** Your very first message should be to upload or paste the **entire contents** of the `ai-context.md` file, preceded by this simple instruction:

    > **You are an expert developer for a Node.js application server called Gingee. Your goal is to help me build a new application on this platform by exclusively using the following context, documentation, and API reference. Analyze it carefully and confirm when you are ready to begin.**
    >
    > `[PASTE THE ENTIRE CONTENTS OF ai-context.md HERE]`

4.  **Give it a Task:** Once the AI confirms it has processed the information, you can start giving it high-level tasks.

    > **Example Follow-up Prompt:**
    >
    > "Great. Now, using Gingee, let's build the `create.js` script for our blog. It should handle a `POST` request to `/posts`, take a JSON body with `title` and `content`, validate that `title` is not empty and has a max length of 100 characters, insert the new post into our `main_db` PostgreSQL database, and return the newly created post with its ID."

The AI now has all the context it needs to generate high-quality, secure, and idiomatic Gingee code, dramatically accelerating your development process.

## Chapter 7: Distributing Your Application

Once you have built and tested your application, Gingee makes it easy to package it for distribution, either publicly or within your organization. A properly packaged app is a self-contained `.gin` file that includes all necessary code, assets, and security manifests.

There are three key steps to preparing your app for distribution.

**1. Declare Your Permissions (`pmft.json`)**

This is the most important step for security and user trust. You must declare what protected Gingee modules your app needs.

*   Create a file at `web/my-app/box/pmft.json`.
*   Define the `mandatory` and `optional` permissions.

**`web/my-app/box/pmft.json`**
```json
{
  "permissions": {
    "mandatory": [
      "db",
      "fs"
    ],
    "optional": [
      "httpclient"
    ]
  }
}
```
*For a full list of permissions, see the Permissions Guide.*

**2. Control Package Contents (`.gpkg`)**

Create a `.gpkg` manifest in your `box` folder to exclude any development-only files (like local SQLite databases or frontend source code in SPA) from the final package.

**`web/my-app/box/.gpkg`**
```json
{
  "include": ["**/*"],
  "exclude": [
    "box/data/**",
    "dev_src/**",
    ".gpkg",
    "pmft.json"
  ]
}
```

**3. Create the Package (`.gin`)**

With the manifests in place, you can now create the final distributable package using the `gingee-cli`. This command connects to your running local server to create the package.

```bash
# Make sure your local Gingee server is running
npm start

# Package the 'my-app' application
gingee-cli package-app --appName my-app
```

This will generate a versioned `.gin` file (e.g., `my-app-v1.2.0.gin`) in your current directory. This single file is all anyone needs to install your application on their own Gingee server using the `gingee-cli install-app` command.


---


# Gingee App Packaging Guide (`.gin` & `.gpkg`)

# Gingee App Packaging Guide (`.gin` & `.gpkg`)

A core feature of the Gingee platform is its standardized application packaging format. This guide explains what a `.gin` file is, why it's used, and how you can control its contents using the `.gpkg` manifest file.

## What is a `.gin` file?

A `.gin` file (short for **Gin**ger **in**stallable) is the official package format for a Gingee application.

At its core, a `.gin` file is simply a **standard ZIP archive** that contains all the necessary code, assets, and configuration for a single application to run on any Gingee server. This single-file format makes distributing, deploying, and versioning your applications simple and reliable.

You can create a `.gin` package for your application using the `glide` admin panel or by running the `gingee-cli package-app` command.

## The Purpose of Packaging

Creating a `.gin` package is the standard way to move an application between environments. The typical workflow is:

1.  **Develop:** Build and test your application in your local development environment.
2.  **Package:** Once ready, use `gingee-cli package-app` to create a versioned package (e.g., `my-blog-v1.2.0.gin`).
3.  **Deploy:** Upload this single `.gin` file to your staging or production server.
4.  **Install/Upgrade:** Use the `glade` admin panel or `gingee-cli install-app` / `upgrade-app` to deploy the package to the live server.

This workflow ensures that deployments are atomic, repeatable, and less error-prone than manually copying files.

## Controlling the Package Contents: The `.gpkg` Manifest

When you build your application for production, you often have files and folders that should **not** be included in the final, distributable package. Examples include:

-   Local development database files (e.g., `box/data/app.db`)
-   Frontend source code directories (e.g., `dev_src/` for a React app)
-   Temporary files or build artifacts
-   Notes and documentation irrelevant to the running app

To control what gets included in your `.gin` file, you can create a manifest file named **`.gpkg`** (short for **G**inger **p**ac**k**a**g**e).

-   **Location:** The `.gpkg` file must be placed in your application's `box` folder (e.g., `web/my-app/box/.gpkg`).
-   **Format:** It is a simple JSON file.

### `.gpkg` Structure and Rules

The manifest contains `include` and `exclude` rules that use standard **glob patterns** to match files and directories.

```json
{
  "version": 1,
  "packager": "gingee-packager",
  "include": [
    "**/*"
  ],
  "exclude": [
    "box/data/**",
    "dev_src/**",
    "**/*.tmp",
    ".gpkg"
  ]
}
```

-   **`include`** (array of strings)
    -   An array of glob patterns for files that should be included.
    -   The default and most common value is `["**/*"]`, which means "include all files and folders recursively."

-   **`exclude`** (array of strings)
    -   An array of glob patterns for files and folders to **exclude** from the final package. These rules are applied after the `include` rules.
    -   **Common Patterns:**
        -   `"box/data/**"`: Excludes the `data` folder inside the `box` and all of its contents. Perfect for ignoring local SQLite databases.
        -   `"dev_src/**"`: Excludes the entire frontend source code directory.
        -   `"**/*.log"`: Excludes all files ending with `.log` from any directory.
        -   `"**/*.tmp"`: Excludes all temporary files.
        -   `".gpkg"`: It is a best practice for the manifest to exclude itself from the package.

### Default Behavior (No `.gpkg` file)

If your application does **not** have a `.gpkg` file in its `box` folder, the `package-app` command will use a set of safe defaults. It will include all files in your app's directory except for common development artifacts like:

-   `node_modules/**`
-   `.git/**`

For full control over your application's distributable package, creating a `.gpkg` manifest is the recommended approach.

## Declaring Security Requirements: The `pmft.json` Manifest

While `.gpkg` controls *what files* are included in your package, the `pmft.json` manifest declares the *security permissions* your application requires to function.

-   **Location:** The `pmft.json` file must be placed in your application's `box` folder (e.g., `web/my-app/box/pmft.json`).
-   **Purpose:** To declare which protected Gingee modules (like `db` or `fs`) your application needs to access. It distinguishes between permissions that are `mandatory` for the app to work and those that are `optional`.

When an administrator installs your `.gin` package using the `gingee-cli`, the CLI will read this file directly from the package and use it to generate a clear, interactive consent prompt. This ensures administrators know exactly what capabilities they are granting to your application.

For a complete guide on the permissions system and the structure of this file, please see the **Gingee Permissions Guide**[MD](./permissions-guide.md) [HTML](./permissions-guide.html).


---


# Gingee Permissions Guide

# Gingee Permissions Guide

Security is a core principle of the Gingee platform. The permissions system is designed to be **secure by default**, following the **Principle of Least Privilege**. This guide explains how permissions are declared by developers and managed by administrators to create a safe and predictable server environment.

## The Philosophy: Secure by Default (Whitelist Model)

Gingee operates on a strict **whitelist model**. By default, a sandboxed application has **no access** to potentially sensitive modules like the filesystem (`fs`), database (`db`), or outbound HTTP client (`httpclient`).

Access to these protected modules must be explicitly **granted** by a server administrator. If a permission has not been granted, any attempt by an app to `require()` that module will result in a security error, and the script will fail to execute.

This model ensures that administrators have full control and awareness of an application's capabilities.

## For App Developers: Declaring Permissions (`pmft.json`)

When you build an application that you intend to distribute (as a `.gin` file) or share, you must declare the permissions it requires in a manifest file. This file acts as a formal request to the administrator who will install your app.

-   **File Name:** `pmft.json` (Permissions Manifest)
-   **Location:** `web/<your-app-name>/box/pmft.json`

The `gingee-cli` will read this file directly from your `.gin` package during installation to prompt the administrator for consent.

### Structure of `pmft.json`

The file contains a single `permissions` object with two keys: `mandatory` and `optional`.

-   **`mandatory`**: An array of permission keys that are **essential** for your app's core functionality. If the administrator denies a mandatory permission, the installation process should be aborted.
-   **`optional`**: An array of permission keys for features that are enhancements but not critical. Your application code should be written to handle cases where an optional permission is not granted.

**Example `pmft.json` for a blog application:**
```json
{
  "permissions": {
    "mandatory": [
      "db",
      "fs"
    ],
    "optional": [
      "httpclient"
    ]
  }
}
```
*In this example, the blog requires database and filesystem access to function. It has an optional feature (perhaps for checking for updates) that requires outbound HTTP calls. This file is the definitive source of truth that the `gingee-cli` will use to generate the interactive consent prompts for the administrator during installation.*

## For Administrators: Managing Permissions

As a server administrator, you have the final authority on what an application is allowed to do. Permissions are managed in a central, server-wide file and can be easily edited via the Glade admin panel.

### The Central Permissions File (`settings/permissions.json`)

This file is the single source of truth for all application grants on your Gingee server.

-   **Location:** `project_root/settings/permissions.json`
-   **Structure:** A JSON object where each key is an application's name. The value is an object containing a `granted` array.

**Example `settings/permissions.json`:**
```json
{
  "glade": {
    "granted": [
      "platform",
      "fs"
    ]
  },
  "my-blog-app": {
    "granted": [
      "db",
      "fs"
    ]
  }
}
```
*In this example, `my-blog-app` was granted its two mandatory permissions, but the administrator chose not to grant the optional `httpclient` permission.*

### Managing Permissions in Glade

The easiest way to manage permissions is through the Glade admin panel. On the main dashboard, each application has a **Permissions** button. Clicking this button will open a modal window where you can safely grant or revoke permissions from the master list.

Saving your changes in this modal will automatically update the `settings/permissions.json` file and trigger a safe reload of the application to immediately apply the new security rules.

## Master Permission List

This is the definitive list of all permission keys available in Gingee.

| Permission Key | Description | Security Implication |
| :--- | :--- | :--- |
| **platform** | **PRIVILEGED.** Allows the app to use the `platform` module to manage the lifecycle (install, delete, upgrade, etc.) of other applications on the server. | **Critical.** This is the highest level of privilege. Only grant this to a fully trusted administration application like `glade`. |
| **cache** | Allows the app to use the caching service for storing and retrieving data. | **High.** Grants access to the centralized cache service. Cache access is isolated for app specific data. |
| **db** | Allows the app to connect to and query the database(s) configured for it in `app.json`. | **High.** Grants access to the application's primary data store. |
| **httpclient** | Permits the app to make outbound HTTP/HTTPS network requests to any external API or website. | **High.** The app can send data to or receive data from any server on the internet. |
| **fs** | Grants full read/write access to files and folders within the app's own secure directories (`box` and `web`). | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files. |
| **pdf** | Allows the app to generate and manipulate PDF documents. | **Medium.** Potential CPU intensive operation that might slow down server performance. |
| **zip** | Allows the app to create and extract ZIP archives. | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files. |
| **image** | Allows the app to manipulate image files. | **Medium.** Potential CPU intensive operation that might slow down server performance. |



---


# GStore - Hosting a Gingee App Store

# GStore - Hosting a Gingee App Store

The Gingee ecosystem is designed to be decentralized. There is no single, official "App Store." Instead, anyone can create and host their own store. A "gstore" is simply a publicly accessible URL that serves a manifest file (`gstore.json`) and the application packages (`.gin` files) it references.

This guide will walk you through the process of creating and hosting your own app store, either for public distribution or for private use within your organization.

## 1. The Store Structure

The structure of a store is incredibly simple. It's a directory of static files. You can organize it however you like, but we recommend the following structure for clarity:

```
my-gingee-store/
├── apps/
│   ├── my-blog-app-v1.0.0.gin
│   └── my-crm-app-v1.2.0.gin
└── gstore.json
```

-   **`gstore.json`:** (Required) The manifest file that defines your store and lists the available applications. This file must be at the root of the URL you share.
-   **`/apps/`:** (Recommended) A subdirectory to hold all your distributable `.gin` package files.

## 2. Creating the `gstore.json` Manifest

The `gstore.json` file is the heart of your store. It's a simple JSON file that the `gingee-cli` reads to get the list of available apps.

Here is a complete example with two applications:

**`gstore.json`**
```json
{
  "storeName": "My Awesome Gingee App Collection",
  "storeVersion": "1.0.0",
  "apps": [
    {
      "name": "my-blog-app",
      "version": "1.0.0",
      "description": "A simple, clean, and fast blogging application.",
      "download_url": "apps/my-blog-app-v1.0.0.gin",
      "publisher": {
        "name": "My Company Inc.",
        "website": "https://www.example.com"
      }
    },
    {
      "name": "my-crm-app",
      "version": "1.2.0",
      "description": "A lightweight CRM for managing customer contacts.",
      "download_url": "https://cdn.example.com/gingee/my-crm-app-v1.2.0.gin",
      "publisher": {
        "name": "My Company Inc."
      }
    }
  ]
}
```

### Key Fields:

-   **`storeName`**: The human-readable name of your store.
-   **`apps`**: An array of application objects. Each object must contain:
    -   **`name`**: The unique, machine-readable name of the app (e.g., `my-blog-app`).
    -   **`version`**: The semantic version number of the package.
    -   **`description`**: A short, one-line description of the app's purpose.
    -   **`download_url`**: The URL where the `.gin` package can be downloaded. This is the most important field.
        -   **Relative Path:** If you are hosting the `.gin` files on the same server as the manifest (as in the `my-blog-app` example), you can use a relative path. The CLI will resolve it correctly.
        -   **Absolute URL:** If you are hosting your packages on a separate CDN or file server (as in the `my-crm-app` example), you must provide the full, absolute URL.
    -   **`publisher`**: An object containing information about who created the app.

## 3. Preparing Your Application Packages

For each application you want to list in your store, you need to create its `.gin` package file.

1.  **Ensure a `pmft.json` exists:** Your application's `box` folder **must** contain a `pmft.json` manifest declaring its required permissions. This is critical for the CLI's secure installation process.
2.  **Create the Package:** Use the `gingee-cli` to package your live application.

    ```bash
    # Connect to the server where your app is running
    gingee-cli login https://my-dev-server.com

    # Package the app
    gingee-cli package-app --appName my-blog-app
    ```
3.  **Place the `.gin` file:** Move the generated package file (e.g., `my-blog-app-v1.0.0.gin`) into your store's `apps/` directory.

## 4. Hosting Your Store

You can host your store on any platform that can serve static files over HTTP/S.

### Option A: Using GitHub Pages (Recommended for Public Stores)

GitHub Pages is a free and easy way to host a public app store.

1.  Create a new public GitHub repository (e.g., `my-gingee-store`).
2.  Push your store directory structure (with `gstore.json` and the `apps/` folder) to the repository.
3.  In the repository's settings, go to the "Pages" section.
4.  Configure it to deploy from your `main` branch and the `/` (root) directory.
5.  GitHub will provide you with a public URL, such as `https://<your-username>.github.io/my-gingee-store/`.

Your store is now live! The URL for your manifest is `https://<your-username>.github.io/my-gingee-store/gstore.json`.

### Option B: Using a Static Web Server

You can use any static web server, such as Nginx, Apache, or even a simple Node.js server like `serve`.

1.  Install a simple server: `npm install -g serve`
2.  Navigate to your store's root directory: `cd my-gingee-store`
3.  Start the server: `serve`

The server will give you a local URL (e.g., `http://localhost:3000`). You can then configure your production server to host these static files.

**Important:** Make sure your web server is configured with the correct CORS headers (`Access-Control-Allow-Origin: *`) to allow the `gingee-cli` to fetch the manifest from any machine.

## 5. Using Your Store

Once your store is hosted, anyone can use it with the `gingee-cli` commands:

```bash
# List all apps in your store
gingee-cli list-store-apps -g "https://<your-username>.github.io/my-gingee-store/"

# Interactively install an app from your store
gingee-cli install-store-app my-blog-app -g "https://<your-username>.github.io/my-gingee-store/" -s "https://<target-gingee-server.com>"
```


---


# Gingee Feature Overview

# Gingee Feature Overview

Gingee is a comprehensive application server designed to accelerate development by providing a rich set of secure, powerful, and easy-to-use features out of the box. This document provides an overview of the key platform features and the standard library of App Modules.

## Key Platform Features

These are the core architectural features that define the Gingee development experience.

*   **Secure Sandbox Execution**
    Every server script runs in a secure, isolated environment. This prevents common vulnerabilities like path traversal and protects the main server process from errors or crashes in application code.

*   **Whitelist-Based Permissions System**
    A secure-by-default model where applications must be explicitly granted privileges by an administrator to access sensitive modules like the filesystem (`fs`), database (`db`), or outbound HTTP client (`httpclient`).

*   **Flexible Routing Engine**
    Gingee features a powerful routing engine with two modes. For regular apps, use the zero-config **File-Based Routing**. For building RESTful APIs, create a `routes.json` manifest to enable **Manifest-Based Routing** with dynamic path parameters (e.g., `/users/:id`).

*   **Multi-Database Abstraction Layer**
    Write your database logic once and deploy against multiple database systems. Gingee supports PostgreSQL, MySQL/MariaDB, SQLite, MS SQL Server, and Oracle, automatically transpiling queries for the target database.

*   **Modern JavaScript Support (ESM)**
    Use modern ES Module syntax (`import`/`from`) directly in your backend scripts. Gingee uses on-the-fly transpilation to handle this automatically, with no build steps or complex `package.json` configuration required.

*   **Application Lifecycle Management**
    A privileged `platform` module allows for full lifecycle management, enabling the creation, packaging (`.gin`), installation, upgrading, backup, and rollback of applications, a powerful module accessible to designated `privileged apps` as configured in `gingee.json`. The default Gingee Glade Admin Tool is one such privileged app.

*   **App Store with Interactive Installation**
    The `gingee-cli` provides commands to browse and install applications from any decentralized "GStore" - the Gingee app store (a static server hosting a `gstore.json` manifest). The installation process is fully interactive, reading a permissions manifest (`pmft.json`) and database requirements directly from the app package to guide the administrator through a secure, one-command setup.

*   **SPA Hosting & Development Workflow**
    Effortlessly host Single Page Applications (React, Angular, Vue). The server is designed to handle client-side routing and supports a seamless "two-server" development workflow via proxying.

*   **Hierarchical & Context-Aware Logging**
    Each app writes to its own structured JSON log file within its private `box` directory, while logs are also forwarded to a central, timestamped server log for a complete system overview.

*   **Resilient Distributed Caching**
    The server provides a centralized, pluggable caching service. Use a dependency-free in-memory cache for local development, or switch to a Redis backend for horizontally scaled production deployments by changing a single line of config.

*   **Application Startup Hooks**
    Apps can define `startup_scripts` in their `app.json` to run one-time initialization logic, such as database schema migrations or cache warming, when the server starts or after an app is installed/upgraded.

## App Module Library

Gingee comes "batteries-included" with a rich standard library of modules. These can be required by name (e.g., `require('crypto')`) from any sandboxed server script.

### Core & System

*   **`gingee`**
    The core middleware and context provider. It provides the `$g` global object (`$g.request`, `$g.response`, etc.) to all server scripts and handles automatic request body parsing.
*   **`cache`**
    A secure, multi-tenant facade module for application data caching. It provides a simple API (`get`, `set`, `del`, `clear`) and automatically namespaces all keys to ensure data isolation between apps.

### Data & I/O

*   **`db`**
    The unified database interface. Provides a consistent API (`query`, `execute`, `transaction`) for interacting with any configured database.
*   **`fs`**
    A secure, virtualized filesystem wrapper. Jails all file and folder operations to an app's private `box` or public `web` scope, preventing path traversal attacks.
*   **`httpclient`**
    A powerful wrapper for making external HTTP(S) requests. It handles redirects, HTTPS, and intelligently processes response bodies into strings or buffers.
*   **`formdata`**
    A simple factory module for creating `multipart/form-data` bodies for file uploads via the `httpclient`.
*   **`zip`**
    A utility for creating and extracting zip archives. It can operate on buffers or files and has secure defaults for cross-scope operations.

### Data Processing & Generation

*   **`image`**
    A high-performance module for server-side image manipulation. Wraps the `sharp` library to provide a secure, chainable API for resizing, filtering, and format conversion.
*   **`html`**
    A server-side web scraping and parsing module. Wraps `cheerio` to load and query HTML from strings, files, or remote URLs.
*   **`qrcode`**
    A generator for both 2D QR Codes (via `qrcode()`) and traditional 1D barcodes (via `barcode()`). It can output generated codes as a PNG `Buffer` or a `DataURL`.
*   **`chart`**
    A server-side chart rendering engine. Wraps `Chart.js` to create beautiful, modern charts as PNG images from a standard JSON configuration.
*   **`dashboard`**
    A powerful composition engine for creating multi-chart dashboards. It uses a JSON grid layout to render multiple charts into a single, unified image.
*   **`pdf`**
    A high-level PDF generation module. Wraps `pdfmake` to create complex, multi-page documents with flowing layouts, tables, and images from a declarative JSON definition.

### Security & Authentication

*   **`auth`**
    An authentication module for managing user sessions. Its first implementation provides a complete, configurable toolkit for creating and verifying JSON Web Tokens (JWT).
*   **`crypto`**
    A comprehensive cryptographic library. Provides tools for hashing, HMAC, secure password management (`argon2`), symmetric encryption (`AES-2GCM`), and random string generation.
*   **`uuid`**
    A dependency-free utility for generating and validating RFC 4122 v4 UUIDs.

### Utilities

*   **`utils`**
    A large "standard library" of general-purpose helpers, organized into namespaces: `rnd` (random data), `string` (manipulation), `validate` (data validation), and `misc`.
*   **`encode`**
    A unified module for all common encoding and decoding needs, including `base64`, `hex`, `uri` components, and `html` entities.
*   **`platform`** (Privileged)
    The privileged, admin-level module for the **Glade Admin Tool**. It provides the APIs to manage the full lifecycle of all applications on the server.


---


# App Module API Reference

## Modules

<dl>
<dt><a href="#module_auth">auth</a></dt>
<dd><p>Provides authentication-related functions, including JWT creation and verification.</p>
</dd>
<dt><a href="#module_cache">cache</a></dt>
<dd><p>Provides a secure interface for caching data within the Gingee application context. 
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_chart">chart</a></dt>
<dd><p>This module provides functionality to create and manipulate charts using Chart.js.
It includes a renderer for generating chart images and a font registration system.</p>
</dd>
<dt><a href="#module_crypto">crypto</a></dt>
<dd><p>Provides cryptographic functions for hashing, encryption, and secure random string generation.</p>
</dd>
<dt><a href="#module_dashboard">dashboard</a></dt>
<dd><p>This module provides functionality to create and manage a dashboard layout with multiple charts.
It allows for rendering charts into specific cells of a defined grid layout.
The dashboard can be initialized with a JSON layout object, and charts can be rendered into specified cells.
The final dashboard image can be exported as a PNG buffer or Data URL.</p>
</dd>
<dt><a href="#module_db">db</a></dt>
<dd><p>Provides a unified interface for database operations, allowing dynamic loading of different database adapters.
This module supports multiple database types by loading the appropriate adapter based on configuration.
It provides methods for querying, executing commands, and managing transactions. 
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_encode">encode</a></dt>
<dd><p>Provides various encoding and decoding utilities for strings, including Base64, URI, hexadecimal, HTML, and Base58.
This module is designed to handle common encoding tasks in a web application context.
It includes methods for encoding and decoding strings in different formats, ensuring compatibility with various data transmission and storage requirements.
It also provides URL-safe encoding methods and HTML entity encoding to prevent XSS attacks.</p>
</dd>
<dt><a href="#module_formdata">formdata</a></dt>
<dd><p>Provides a factory function to create FormData instances.
This module is used to handle form data in HTTP requests, allowing for easy construction of multipart/form-data requests.
It simplifies the process of appending fields and files to the form data, and provides a method to get headers for use with HTTP clients.
It is particularly useful for uploading files and sending complex data structures in web applications.
It abstracts the complexities of constructing multipart requests, making it easier to work with file uploads and form submissions.</p>
</dd>
<dt><a href="#module_fs">fs</a></dt>
<dd><p>A secure file system module for Gingee that provides secure sandboxed synchronous and asynchronous file operations.
<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_html">html</a></dt>
<dd><p>A module for parsing and manipulating HTML using <a href="https://cheerio.js.org/">Cheerio</a>.
It provides functions to load HTML from strings, files, and URLs, allowing for easy querying and manipulation of HTML documents.
This module is particularly useful for web scraping, data extraction, and HTML manipulation tasks in Gingee applications.
It abstracts the complexities of working with raw HTML, providing a simple and consistent API for developers.
It leverages the Cheerio library to provide a jQuery-like syntax for traversing and manipulating the HTML structure.
It supports both synchronous and asynchronous operations, making it flexible for various use cases.</p>
</dd>
<dt><a href="#module_httpclient">httpclient</a></dt>
<dd><p>A module for making HTTP requests in Gingee applications.
This module provides functions to perform GET and POST requests, supporting various content types.
It abstracts the complexities of making HTTP requests, providing a simple interface for developers to interact with web services.
It supports both text and binary responses, automatically determining the response type based on the content-type header.
It is particularly useful for applications that need to fetch resources from external APIs or web services, and for sending data to web services in different formats.
It allows for flexible data submission, making it suitable for APIs that require different content types.
It provides constants for common POST data types, ensuring that the correct headers are set for the request.
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_image">image</a></dt>
<dd><p>A module for image processing using the <a href="https://sharp.pixelplumbing.com/">Sharp</a> library.
It provides a simple and secure way to manipulate images, including resizing, rotating, flipping, and more.
<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_pdf">pdf</a></dt>
<dd><p>This module provides functionality to create PDF documents using pdfmake.
It includes a default font configuration with Roboto and a function to create PDFs from document definitions.
It is designed to be used in a secure environment, ensuring that only allowed fonts are registered.
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_platform">platform</a></dt>
<dd><p>A module for Gingee platform-specific utilities and functions. Ideally used by only platform-level apps. 
To use this module the app needs to be declared in the <code>privilegedApps</code> list in the gingee.json server config.
<b>IMPORTANT:</b> Requires privileged app config and explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
<dt><a href="#module_qrcode">qrcode</a></dt>
<dd><p>Provides functions to generate QR codes and 1D barcodes.</p>
</dd>
<dt><a href="#module_utils">utils</a></dt>
<dd><p>A collection of utility functions for various tasks.
This module provides functions for generating random data, validating inputs, manipulating strings, and more.
It abstracts common tasks into reusable functions, making it easier to write clean and maintainable code.
It is particularly useful for tasks that require randomization, validation, or string manipulation.</p>
</dd>
<dt><a href="#module_uuid">uuid</a></dt>
<dd><p>Provides functions to generate and validate UUIDs (Universally Unique Identifiers).</p>
</dd>
<dt><a href="#module_zip">zip</a></dt>
<dd><p>Provides functions to zip and unzip files and directories securely.
This module allows you to create zip archives from files or directories, and extract zip files to specified locations.
It ensures that all file operations are performed within the secure boundaries defined by the Gingee framework.
<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script
<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.</p>
</dd>
</dl>

<a name="module_auth"></a>

## auth
Provides authentication-related functions, including JWT creation and verification.


* [auth](#module_auth)
    * [.jwt](#module_auth.jwt) : <code>object</code>
        * [.create(payload, [expiresIn])](#module_auth.jwt.create) ⇒ <code>string</code>
        * [.verify(token)](#module_auth.jwt.verify) ⇒ <code>object</code> \| <code>null</code>

<a name="module_auth.jwt"></a>

### auth.jwt : <code>object</code>
Provides methods for creating and verifying JSON Web Tokens (JWTs).

**Kind**: static namespace of [<code>auth</code>](#module_auth)  

* [.jwt](#module_auth.jwt) : <code>object</code>
    * [.create(payload, [expiresIn])](#module_auth.jwt.create) ⇒ <code>string</code>
    * [.verify(token)](#module_auth.jwt.verify) ⇒ <code>object</code> \| <code>null</code>

<a name="module_auth.jwt.create"></a>

#### jwt.create(payload, [expiresIn]) ⇒ <code>string</code>
Creates a JSON Web Token (JWT) with the given payload and expiration.

**Kind**: static method of [<code>jwt</code>](#module_auth.jwt)  
**Returns**: <code>string</code> - The JWT string.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| payload | <code>object</code> |  | The data to include in the token. |
| [expiresIn] | <code>string</code> | <code>&quot;&#x27;1h&#x27;&quot;</code> | The token's lifespan. |

**Example**  
```js
const token = auth.jwt.create({ userId: 42, role: 'admin' }, '2h');
```
<a name="module_auth.jwt.verify"></a>

#### jwt.verify(token) ⇒ <code>object</code> \| <code>null</code>
Verifies a JWT and returns its payload if valid.

**Kind**: static method of [<code>jwt</code>](#module_auth.jwt)  
**Returns**: <code>object</code> \| <code>null</code> - The token's payload if valid and not expired, otherwise null.  

| Param | Type | Description |
| --- | --- | --- |
| token | <code>string</code> | The JWT string to verify. |

**Example**  
```js
const payload = auth.jwt.verify(token);if (payload) {    console.log("Token is valid:", payload);} else {    console.log("Token is invalid or expired.");}
```
<a name="module_cache"></a>

## cache
Provides a secure interface for caching data within the Gingee application context. <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [cache](#module_cache)
    * [.get(key)](#module_cache.get) ⇒ <code>Promise.&lt;any&gt;</code>
    * [.set(key, value, [ttl])](#module_cache.set) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.del(key)](#module_cache.del) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.clear()](#module_cache.clear) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="module_cache.get"></a>

### cache.get(key) ⇒ <code>Promise.&lt;any&gt;</code>
Retrieves a value from the application's cache using a namespaced key.

**Kind**: static method of [<code>cache</code>](#module_cache)  
**Returns**: <code>Promise.&lt;any&gt;</code> - A promise that resolves with the cached value, or null if not found.  
**Throws**:

- <code>Error</code> If the key is invalid or retrieval fails.


| Param | Type | Description |
| --- | --- | --- |
| key | <code>string</code> | The key to retrieve. |

**Example**  
```js
const cache = require('cache');const value = await cache.get('my_key');if (value) {   console.log(`Value found: ${JSON.stringify(value)}`);} else {   console.log("Key not found in cache.");}
```
<a name="module_cache.set"></a>

### cache.set(key, value, [ttl]) ⇒ <code>Promise.&lt;void&gt;</code>
Stores a value in the application's cache.

**Kind**: static method of [<code>cache</code>](#module_cache)  
**Throws**:

- <code>Error</code> If the key is invalid or storage fails.


| Param | Type | Description |
| --- | --- | --- |
| key | <code>string</code> | The key to store the value under. |
| value | <code>any</code> | The JSON-serializable value to store. |
| [ttl] | <code>number</code> | Optional Time-To-Live in seconds. Uses the server default if not provided. |

**Example**  
```js
const cache = require('cache');await cache.set('my_key', { message: 'Hello, world!' }, 3600);console.log("Value stored in cache.");
```
<a name="module_cache.del"></a>

### cache.del(key) ⇒ <code>Promise.&lt;void&gt;</code>
Deletes a value from the application's cache using a namespaced key.

**Kind**: static method of [<code>cache</code>](#module_cache)  
**Throws**:

- <code>Error</code> If the key is invalid or deletion fails.


| Param | Type | Description |
| --- | --- | --- |
| key | <code>string</code> | The key to delete. |

**Example**  
```js
const cache = require('cache');await cache.del('my_key');console.log("Value deleted from cache.");
```
<a name="module_cache.clear"></a>

### cache.clear() ⇒ <code>Promise.&lt;void&gt;</code>
Clears all cached values for the current application. This does not affect other applications' caches.

**Kind**: static method of [<code>cache</code>](#module_cache)  
**Throws**:

- <code>Error</code> If the clear operation fails.

**Example**  
```js
const cache = require('cache');await cache.clear();console.log("All cache cleared.");
```
<a name="module_chart"></a>

## chart
This module provides functionality to create and manipulate charts using Chart.js.It includes a renderer for generating chart images and a font registration system.


* [chart](#module_chart)
    * _static_
        * [.runInGBox(configuration, [options])](#module_chart.runInGBox) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>
        * [.registerFont(scope, filePath, options)](#module_chart.registerFont)
    * _inner_
        * [~DATA_URL](#module_chart..DATA_URL)

<a name="module_chart.runInGBox"></a>

### chart.runInGBox(configuration, [options]) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>
Renders a chart based on a Chart.js configuration object.

**Kind**: static method of [<code>chart</code>](#module_chart)  
**Returns**: <code>Promise.&lt;(Buffer\|string)&gt;</code> - A promise that resolves with the chart image data.  
**Throws**:

- <code>Error</code> If the configuration is invalid or rendering fails.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| configuration | <code>object</code> |  | A standard Chart.js configuration object (type, data, options). |
| [options] | <code>object</code> |  | Optional settings for the output. |
| [options.width] | <code>number</code> | <code>800</code> | The width of the final image in pixels. |
| [options.height] | <code>number</code> | <code>600</code> | The height of the final image in pixels. |
| [options.output] | <code>string</code> | <code>&quot;&#x27;buffer&#x27;&quot;</code> | The output type: 'buffer' or 'dataurl'. |

**Example**  
```js
const chart = require('chart');const config = {    type: 'bar',    data: {        labels: ['January', 'February', 'March'],        datasets: [{            label: 'Sales',            data: [100, 200, 300]        }]    }};const imageBuffer = await chart.render(config);// To send the image in a http response:$g.response.send(imageBuffer, 200, 'image/png');
```
<a name="module_chart.registerFont"></a>

### chart.registerFont(scope, filePath, options)
Registers a custom font from a file to be used in charts.This should be called at the application's startup or in a default_include script.

**Kind**: static method of [<code>chart</code>](#module_chart)  
**Throws**:

- <code>Error</code> If the font file cannot be found or registered.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope where the font file is located (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the .ttf or .otf font file. |
| options | <code>object</code> | Font registration options. |
| options.family | <code>string</code> | The font-family name to use in Chart.js configs (e.g., 'Roboto'). |

**Example**  
```js
chart.registerFont(fs.BOX, 'path/to/Roboto-Regular.ttf', { family: 'Roboto' });
```
<a name="module_chart..DATA_URL"></a>

### chart~DATA\_URL
This constant represents the output type for rendering charts as a Data URL.

**Kind**: inner constant of [<code>chart</code>](#module_chart)  
<a name="module_crypto"></a>

## crypto
Provides cryptographic functions for hashing, encryption, and secure random string generation.


* [crypto](#module_crypto)
    * [.CRC32(inputString)](#module_crypto.CRC32) ⇒ <code>number</code>
    * [.MD5(inputString)](#module_crypto.MD5) ⇒ <code>string</code>
    * [.SHA2(inputString)](#module_crypto.SHA2) ⇒ <code>string</code>
    * [.SHA3(inputString)](#module_crypto.SHA3) ⇒ <code>string</code>
    * [.hmacSha256Encrypt(inputString, secret)](#module_crypto.hmacSha256Encrypt) ⇒ <code>string</code>
    * [.hmacSha256Verify(encryptedString, originalString, secret)](#module_crypto.hmacSha256Verify) ⇒ <code>boolean</code>
    * [.encrypt(textToEncrypt, secret)](#module_crypto.encrypt) ⇒ <code>string</code>
    * [.decrypt(encryptedPackage, secret)](#module_crypto.decrypt) ⇒ <code>string</code> \| <code>null</code>
    * [.hashPassword(plainTextPassword)](#module_crypto.hashPassword) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.verifyPassword(plainTextPassword, hash)](#module_crypto.verifyPassword) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [.generateSecureRandomString(length)](#module_crypto.generateSecureRandomString) ⇒ <code>string</code>

<a name="module_crypto.CRC32"></a>

### crypto.CRC32(inputString) ⇒ <code>number</code>
Computes the CRC32 checksum for a string.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>number</code> - The CRC32 checksum as an integer.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to process. |

**Example**  
```js
const checksum = crypto.CRC32("Hello, World!");console.log("CRC32 Checksum:", checksum);
```
<a name="module_crypto.MD5"></a>

### crypto.MD5(inputString) ⇒ <code>string</code>
Computes the MD5 hash for a string.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - The MD5 hash as a hex string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to process. |

**Example**  
```js
const hash = crypto.MD5("Hello, World!");console.log("MD5 Hash:", hash);
```
<a name="module_crypto.SHA2"></a>

### crypto.SHA2(inputString) ⇒ <code>string</code>
Computes the SHA256 hash for a string. (SHA2 is a family, SHA256 is the most common)

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - The SHA256 hash as a hex string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to process. |

**Example**  
```js
const hash = crypto.SHA2("Hello, World!");console.log("SHA256 Hash:", hash);
```
<a name="module_crypto.SHA3"></a>

### crypto.SHA3(inputString) ⇒ <code>string</code>
Computes the SHA3-256 hash for a string.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - The SHA3-256 hash as a hex string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to process. |

**Example**  
```js
const hash = crypto.SHA3("Hello, World!");console.log("SHA3-256 Hash:", hash);
```
<a name="module_crypto.hmacSha256Encrypt"></a>

### crypto.hmacSha256Encrypt(inputString, secret) ⇒ <code>string</code>
Encrypts (signs) a string using HMAC-SHA256.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - The HMAC signature as a hex string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to encrypt/sign. |
| secret | <code>string</code> | The secret key. |

**Example**  
```js
const signature = crypto.hmacSha256Encrypt("Hello, World!", "my-secret");console.log("HMAC-SHA256 Signature:", signature);
```
<a name="module_crypto.hmacSha256Verify"></a>

### crypto.hmacSha256Verify(encryptedString, originalString, secret) ⇒ <code>boolean</code>
Verifies an HMAC-SHA256 signature.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>boolean</code> - True if the signature is valid, false otherwise.  

| Param | Type | Description |
| --- | --- | --- |
| encryptedString | <code>string</code> | The signature (hex string) to verify. |
| originalString | <code>string</code> | The original, unencrypted string. |
| secret | <code>string</code> | The secret key used for signing. |

**Example**  
```js
const isValid = crypto.hmacSha256Verify(signature, "Hello, World!", "my-secret");console.log("Is the signature valid? - ", isValid);
```
<a name="module_crypto.encrypt"></a>

### crypto.encrypt(textToEncrypt, secret) ⇒ <code>string</code>
Encrypts text using AES-256-GCM.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - A combined string "iv:authtag:encryptedtext" in hex format.  

| Param | Type | Description |
| --- | --- | --- |
| textToEncrypt | <code>string</code> | The plaintext string. |
| secret | <code>string</code> | The secret key to use for encryption. |

**Example**  
```js
const encrypted = crypto.encrypt("Hello, World!", "my-secret");console.log("Encrypted Text:", encrypted);
```
<a name="module_crypto.decrypt"></a>

### crypto.decrypt(encryptedPackage, secret) ⇒ <code>string</code> \| <code>null</code>
Decrypts text that was encrypted with the encrypt() function.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> \| <code>null</code> - The original plaintext or null if decryption fails.  
**Throws**:

- <code>Error</code> If the decryption fails due to an invalid format or other issues.


| Param | Type | Description |
| --- | --- | --- |
| encryptedPackage | <code>string</code> | The "iv:authtag:encryptedtext" string. |
| secret | <code>string</code> | The secret key used for encryption. |

**Example**  
```js
const decrypted = crypto.decrypt("iv:authtag:encryptedtext", "my-secret");console.log("Decrypted Text:", decrypted);
```
<a name="module_crypto.hashPassword"></a>

### crypto.hashPassword(plainTextPassword) ⇒ <code>Promise.&lt;string&gt;</code>
Securely hashes a password using Argon2.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>Promise.&lt;string&gt;</code> - A promise that resolves to the full hash string.  

| Param | Type | Description |
| --- | --- | --- |
| plainTextPassword | <code>string</code> | The user's password. |

**Example**  
```js
const hash = await crypto.hashPassword("mySecurePassword");console.log("Hashed Password:", hash);
```
<a name="module_crypto.verifyPassword"></a>

### crypto.verifyPassword(plainTextPassword, hash) ⇒ <code>Promise.&lt;boolean&gt;</code>
Verifies a plaintext password against an Argon2 hash.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A promise that resolves to true if they match, false otherwise.  

| Param | Type | Description |
| --- | --- | --- |
| plainTextPassword | <code>string</code> | The password to check. |
| hash | <code>string</code> | The hash string from the database. |

**Example**  
```js
const isValid = await crypto.verifyPassword("mySecurePassword", hash);console.log("Is the password valid? - ", isValid);
```
<a name="module_crypto.generateSecureRandomString"></a>

### crypto.generateSecureRandomString(length) ⇒ <code>string</code>
Generates a cryptographically secure random string.

**Kind**: static method of [<code>crypto</code>](#module_crypto)  
**Returns**: <code>string</code> - A random, URL-safe string.  

| Param | Type | Description |
| --- | --- | --- |
| length | <code>number</code> | The desired length of the final string. |

**Example**  
```js
const randomString = crypto.generateSecureRandomString(32);console.log("Random String:", randomString);
```
<a name="module_dashboard"></a>

## dashboard
This module provides functionality to create and manage a dashboard layout with multiple charts.It allows for rendering charts into specific cells of a defined grid layout.The dashboard can be initialized with a JSON layout object, and charts can be rendered into specified cells.The final dashboard image can be exported as a PNG buffer or Data URL.


* [dashboard](#module_dashboard)
    * _static_
        * [.init(layout)](#module_dashboard.init) ⇒ <code>Dashboard</code>
    * _inner_
        * [~Dashboard](#module_dashboard..Dashboard)
            * [new Dashboard(layout)](#new_module_dashboard..Dashboard_new)
            * [.renderChart(cellName, chartConfig)](#module_dashboard..Dashboard+renderChart) ⇒ <code>Promise.&lt;Dashboard&gt;</code>
            * [.toBuffer()](#module_dashboard..Dashboard+toBuffer) ⇒ <code>Buffer</code>
            * [.toDataURL()](#module_dashboard..Dashboard+toDataURL) ⇒ <code>string</code>

<a name="module_dashboard.init"></a>

### dashboard.init(layout) ⇒ <code>Dashboard</code>
Initializes a new dashboard layout.

**Kind**: static method of [<code>dashboard</code>](#module_dashboard)  
**Returns**: <code>Dashboard</code> - An instance of the Dashboard class, ready for rendering.  

| Param | Type | Description |
| --- | --- | --- |
| layout | <code>object</code> | The JSON object defining the dashboard layout. |

**Example**  
```js
const dashboardLayout = {    width: 1200,    height: 800,    backgroundColor: '#F5F5F5',    grid: { rows: 2, cols: 2, padding: 20 },    cells: {        "bar-chart": { "row": 0, "col": 0, "colspan": 2 },        "pie-chart": { "row": 1, "col": 0 },        "line-chart": { "row": 1, "col": 1 }    }};const myDashboard = dashboard.init(dashboardLayout);// Now you can render charts into the dashboard:const finalImageBuffer = myDashboard.toBuffer();// To send the image in a http response:$g.response.send(finalImageBuffer, 200, 'image/png');
```
<a name="module_dashboard..Dashboard"></a>

### dashboard~Dashboard
The Dashboard class manages the layout, canvas, and rendering of multiple charts.This class is returned by the init() function.It provides methods to render charts into specific cells and export the final dashboard image.

**Kind**: inner class of [<code>dashboard</code>](#module_dashboard)  

* [~Dashboard](#module_dashboard..Dashboard)
    * [new Dashboard(layout)](#new_module_dashboard..Dashboard_new)
    * [.renderChart(cellName, chartConfig)](#module_dashboard..Dashboard+renderChart) ⇒ <code>Promise.&lt;Dashboard&gt;</code>
    * [.toBuffer()](#module_dashboard..Dashboard+toBuffer) ⇒ <code>Buffer</code>
    * [.toDataURL()](#module_dashboard..Dashboard+toDataURL) ⇒ <code>string</code>

<a name="new_module_dashboard..Dashboard_new"></a>

#### new Dashboard(layout)
Initializes the Dashboard instance with a layout object.The layout should define the grid structure and cell definitions.

**Throws**:

- <code>Error</code> If the layout is invalid or missing required properties.


| Param | Type | Description |
| --- | --- | --- |
| layout | <code>object</code> | The JSON object defining the dashboard layout. |

<a name="module_dashboard..Dashboard+renderChart"></a>

#### dashboard.renderChart(cellName, chartConfig) ⇒ <code>Promise.&lt;Dashboard&gt;</code>
Renders a chart into a specified cell of the dashboard.

**Kind**: instance method of [<code>Dashboard</code>](#module_dashboard..Dashboard)  
**Returns**: <code>Promise.&lt;Dashboard&gt;</code> - A promise that resolves with the Dashboard instance for chaining.  

| Param | Type | Description |
| --- | --- | --- |
| cellName | <code>string</code> | The name of the cell (defined in the layout) to render into. |
| chartConfig | <code>object</code> | A standard Chart.js configuration object. |

<a name="module_dashboard..Dashboard+toBuffer"></a>

#### dashboard.toBuffer() ⇒ <code>Buffer</code>
Returns the final dashboard image as a PNG buffer.

**Kind**: instance method of [<code>Dashboard</code>](#module_dashboard..Dashboard)  
<a name="module_dashboard..Dashboard+toDataURL"></a>

#### dashboard.toDataURL() ⇒ <code>string</code>
Returns the final dashboard image as a Data URL.

**Kind**: instance method of [<code>Dashboard</code>](#module_dashboard..Dashboard)  
<a name="module_db"></a>

## db
Provides a unified interface for database operations, allowing dynamic loading of different database adapters.This module supports multiple database types by loading the appropriate adapter based on configuration.It provides methods for querying, executing commands, and managing transactions. <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [db](#module_db)
    * [.query(dbName, sql, params)](#module_db.query) ⇒ <code>Promise.&lt;Object&gt;</code>
        * [.one(dbName, sql, params)](#module_db.query.one) ⇒ <code>Promise.&lt;(Object\|null)&gt;</code>
        * [.many(dbName, sql, params)](#module_db.query.many) ⇒ <code>Promise.&lt;Array&gt;</code>
    * [.execute(dbName, sql, params)](#module_db.execute) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.transaction(dbName, callback)](#module_db.transaction) ⇒ <code>Promise.&lt;any&gt;</code>

<a name="module_db.query"></a>

### db.query(dbName, sql, params) ⇒ <code>Promise.&lt;Object&gt;</code>
Executes a SQL query against the specified database.

**Kind**: static method of [<code>db</code>](#module_db)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - The result of the query.  
**Throws**:

- <code>Error</code> If the database connection is not configured or the query fails.
- <code>Error</code> If the SQL query is invalid or the parameters do not match.


| Param | Type | Description |
| --- | --- | --- |
| dbName | <code>string</code> | The name of the database to query. |
| sql | <code>string</code> | The SQL query string. |
| params | <code>Array</code> | The parameters for the query. |

**Example**  
```js
const result = await db.query('myDatabase', 'SELECT * FROM users WHERE id = ?', [userId]);console.log(result);
```

* [.query(dbName, sql, params)](#module_db.query) ⇒ <code>Promise.&lt;Object&gt;</code>
    * [.one(dbName, sql, params)](#module_db.query.one) ⇒ <code>Promise.&lt;(Object\|null)&gt;</code>
    * [.many(dbName, sql, params)](#module_db.query.many) ⇒ <code>Promise.&lt;Array&gt;</code>

<a name="module_db.query.one"></a>

#### query.one(dbName, sql, params) ⇒ <code>Promise.&lt;(Object\|null)&gt;</code>
Executes a SQL query against the specified database and returns a single result.

**Kind**: static method of [<code>query</code>](#module_db.query)  
**Returns**: <code>Promise.&lt;(Object\|null)&gt;</code> - The first row of the result or null if no rows were found.  
**Throws**:

- <code>Error</code> If the database connection is not configured or the query fails.
- <code>Error</code> If the SQL query is invalid or the parameters do not match.


| Param | Type | Description |
| --- | --- | --- |
| dbName | <code>string</code> | The name of the database to query. |
| sql | <code>string</code> | The SQL query string. |
| params | <code>Array</code> | The parameters for the query. |

**Example**  
```js
const user = await db.query.one('myDatabase', 'SELECT * FROM users WHERE id = ?', [userId]);if (user) {    console.log(`User found: ${user.name}`);} else {    console.log("User not found");}
```
<a name="module_db.query.many"></a>

#### query.many(dbName, sql, params) ⇒ <code>Promise.&lt;Array&gt;</code>
Executes a SQL query against the specified database and returns multiple results.

**Kind**: static method of [<code>query</code>](#module_db.query)  
**Returns**: <code>Promise.&lt;Array&gt;</code> - An array of rows returned by the query.  
**Throws**:

- <code>Error</code> If the database connection is not configured or the query fails.
- <code>Error</code> If the SQL query is invalid or the parameters do not match.


| Param | Type | Description |
| --- | --- | --- |
| dbName | <code>string</code> | The name of the database to query. |
| sql | <code>string</code> | The SQL query string. |
| params | <code>Array</code> | The parameters for the query. |

**Example**  
```js
const users = await db.query.many('myDatabase', 'SELECT * FROM users WHERE active = ?', [true]);console.log(`Found ${users.length} active users.`);
```
<a name="module_db.execute"></a>

### db.execute(dbName, sql, params) ⇒ <code>Promise.&lt;Object&gt;</code>
Executes a SQL update/insert/delete command against the specified database.

**Kind**: static method of [<code>db</code>](#module_db)  
**Returns**: <code>Promise.&lt;Object&gt;</code> - The result of the execution, typically containing row count or status.  
**Throws**:

- <code>Error</code> If the database connection is not configured or the command fails.
- <code>Error</code> If the SQL command is invalid or the parameters do not match.


| Param | Type | Description |
| --- | --- | --- |
| dbName | <code>string</code> | The name of the database to execute the command on. |
| sql | <code>string</code> | The SQL insert/update/delete command string. |
| params | <code>Array</code> | The parameters for the command. |

**Example**  
```js
const result = await db.execute('myDatabase', 'UPDATE users SET active = ? WHERE id = ?', [false, userId]);console.log(`Rows affected: ${result.rowCount}`);
```
<a name="module_db.transaction"></a>

### db.transaction(dbName, callback) ⇒ <code>Promise.&lt;any&gt;</code>
Executes a transaction with the provided callback function.

**Kind**: static method of [<code>db</code>](#module_db)  
**Returns**: <code>Promise.&lt;any&gt;</code> - The result of the transaction callback.  
**Throws**:

- <code>Error</code> If the transaction fails or the callback throws an error.
- <code>Error</code> If the database connection is not configured.


| Param | Type | Description |
| --- | --- | --- |
| dbName | <code>string</code> | The name of the database to use for the transaction. |
| callback | <code>function</code> | The function to execute within the transaction context. |

**Example**  
```js
await db.transaction('myDatabase', async (client) => {    await client.execute('INSERT INTO users (name) VALUES (?)', ['Alice']);});
```
<a name="module_encode"></a>

## encode
Provides various encoding and decoding utilities for strings, including Base64, URI, hexadecimal, HTML, and Base58.This module is designed to handle common encoding tasks in a web application context.It includes methods for encoding and decoding strings in different formats, ensuring compatibility with various data transmission and storage requirements.It also provides URL-safe encoding methods and HTML entity encoding to prevent XSS attacks.


* [encode](#module_encode)
    * [.base64](#module_encode.base64) : <code>object</code>
        * [.encode(inputString)](#module_encode.base64.encode) ⇒ <code>string</code>
        * [.decode(base64String)](#module_encode.base64.decode) ⇒ <code>string</code>
        * [.encodeUrl(input)](#module_encode.base64.encodeUrl) ⇒ <code>string</code>
        * [.decodeUrl(input)](#module_encode.base64.decodeUrl) ⇒ <code>string</code>
    * [.uri](#module_encode.uri) : <code>object</code>
        * [.encode(inputString)](#module_encode.uri.encode) ⇒ <code>string</code>
        * [.decode(encodedString)](#module_encode.uri.decode) ⇒ <code>string</code>
    * [.hex](#module_encode.hex) : <code>object</code>
        * [.encode(inputString)](#module_encode.hex.encode) ⇒ <code>string</code>
        * [.decode(hexString)](#module_encode.hex.decode) ⇒ <code>string</code>
    * [.html](#module_encode.html) : <code>object</code>
        * [.encode(inputString)](#module_encode.html.encode) ⇒ <code>string</code>
        * [.decode(encodedString)](#module_encode.html.decode) ⇒ <code>string</code>
    * [.base58](#module_encode.base58) : <code>object</code>
        * [.encode(inputBuffer)](#module_encode.base58.encode) ⇒ <code>string</code>
        * [.decode(base58String)](#module_encode.base58.decode) ⇒ <code>Buffer</code>

<a name="module_encode.base64"></a>

### encode.base64 : <code>object</code>
Provides methods for Base64 encoding and decoding.This namespace includes functions to encode and decode strings in Base64 format, which is commonly used for data transmission in web applications.It supports both standard Base64 and URL-safe Base64 encoding.

**Kind**: static namespace of [<code>encode</code>](#module_encode)  

* [.base64](#module_encode.base64) : <code>object</code>
    * [.encode(inputString)](#module_encode.base64.encode) ⇒ <code>string</code>
    * [.decode(base64String)](#module_encode.base64.decode) ⇒ <code>string</code>
    * [.encodeUrl(input)](#module_encode.base64.encodeUrl) ⇒ <code>string</code>
    * [.decodeUrl(input)](#module_encode.base64.decodeUrl) ⇒ <code>string</code>

<a name="module_encode.base64.encode"></a>

#### base64.encode(inputString) ⇒ <code>string</code>
Encodes a UTF-8 string into a Base64 string.

**Kind**: static method of [<code>base64</code>](#module_encode.base64)  
**Returns**: <code>string</code> - The Base64 encoded string or null if the input is not a string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to encode. |

**Example**  
```js
const encoded = base64.encode('Hello, World!');console.log(encoded); // Outputs: SGVsbG8sIFdvcmxkIQ==
```
<a name="module_encode.base64.decode"></a>

#### base64.decode(base64String) ⇒ <code>string</code>
Decodes a Base64 string back into a UTF-8 string.

**Kind**: static method of [<code>base64</code>](#module_encode.base64)  
**Returns**: <code>string</code> - The original UTF-8 string or null if the input is not a string.  

| Param | Type | Description |
| --- | --- | --- |
| base64String | <code>string</code> | The Base64 string to decode. |

**Example**  
```js
const decoded = base64.decode('SGVsbG8sIFdvcmxkIQ==');console.log(decoded); // Outputs: Hello, World!
```
<a name="module_encode.base64.encodeUrl"></a>

#### base64.encodeUrl(input) ⇒ <code>string</code>
Encodes a string using the URL-safe Base64 variant.This replaces '+' with '-', '/' with '_', and removes padding ('=').It is useful for encoding data that will be included in URLs or HTTP headers.

**Kind**: static method of [<code>base64</code>](#module_encode.base64)  
**Returns**: <code>string</code> - The Base64Url encoded string.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>string</code> | The string or buffer to encode. |

**Example**  
```js
const encodedUrl = base64.encodeUrl('Hello, World!');console.log(encodedUrl); // Outputs: SGVsbG8sIFdvcmxkIQ==
```
<a name="module_encode.base64.decodeUrl"></a>

#### base64.decodeUrl(input) ⇒ <code>string</code>
Decodes a Base64Url encoded string.This reverses the URL-safe encoding by replacing '-' with '+', '_' with '/', and adding padding if necessary.It is useful for decoding data that was encoded for use in URLs or HTTP headers.

**Kind**: static method of [<code>base64</code>](#module_encode.base64)  
**Returns**: <code>string</code> - The decoded string.  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>string</code> | The Base64Url string. |

**Example**  
```js
const decodedUrl = base64.decodeUrl('SGVsbG8sIFdvcmxkIQ');console.log(decodedUrl); // Outputs: Hello, World!
```
<a name="module_encode.uri"></a>

### encode.uri : <code>object</code>
Provides methods for URI encoding and decoding.This namespace includes functions to safely encode and decode strings for use in URIs, ensuring that special characters are properly handled.It is useful for preparing data to be included in URLs, query parameters, or path segments

**Kind**: static namespace of [<code>encode</code>](#module_encode)  

* [.uri](#module_encode.uri) : <code>object</code>
    * [.encode(inputString)](#module_encode.uri.encode) ⇒ <code>string</code>
    * [.decode(encodedString)](#module_encode.uri.decode) ⇒ <code>string</code>

<a name="module_encode.uri.encode"></a>

#### uri.encode(inputString) ⇒ <code>string</code>
Encodes a string for use in a URI.

**Kind**: static method of [<code>uri</code>](#module_encode.uri)  
**Returns**: <code>string</code> - The encoded URI component.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to encode. |

**Example**  
```js
const encoded = uri.encode('Hello, World!');console.log(encoded); // Outputs: Hello%2C%20World%21
```
<a name="module_encode.uri.decode"></a>

#### uri.decode(encodedString) ⇒ <code>string</code>
Decodes a URI-encoded string.

**Kind**: static method of [<code>uri</code>](#module_encode.uri)  
**Returns**: <code>string</code> - The decoded string.  

| Param | Type | Description |
| --- | --- | --- |
| encodedString | <code>string</code> | The encoded string to decode. |

**Example**  
```js
const decoded = uri.decode('Hello%2C%20World%21');console.log(decoded); // Outputs: Hello, World!
```
<a name="module_encode.hex"></a>

### encode.hex : <code>object</code>
Provides methods for hexadecimal encoding and decoding.This namespace includes functions to convert strings to and from hexadecimal format, which is often used for data representation in computing.It is useful for encoding binary data as a readable string format, commonly used in cryptography and data transmission.

**Kind**: static namespace of [<code>encode</code>](#module_encode)  

* [.hex](#module_encode.hex) : <code>object</code>
    * [.encode(inputString)](#module_encode.hex.encode) ⇒ <code>string</code>
    * [.decode(hexString)](#module_encode.hex.decode) ⇒ <code>string</code>

<a name="module_encode.hex.encode"></a>

#### hex.encode(inputString) ⇒ <code>string</code>
Encodes a string into hexadecimal format.

**Kind**: static method of [<code>hex</code>](#module_encode.hex)  
**Returns**: <code>string</code> - The hexadecimal encoded string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to encode. |

**Example**  
```js
const encoded = hex.encode('Hello, World!');console.log(encoded); // Outputs: 48656c6c6f2c20576f726c6421
```
<a name="module_encode.hex.decode"></a>

#### hex.decode(hexString) ⇒ <code>string</code>
Decodes a hexadecimal string back into a UTF-8 string.

**Kind**: static method of [<code>hex</code>](#module_encode.hex)  
**Returns**: <code>string</code> - The original UTF-8 string.  

| Param | Type | Description |
| --- | --- | --- |
| hexString | <code>string</code> | The hexadecimal string to decode. |

**Example**  
```js
const decoded = hex.decode('48656c6c6f2c20576f726c6421');console.log(decoded); // Outputs: Hello, World!
```
<a name="module_encode.html"></a>

### encode.html : <code>object</code>
Provides methods for HTML encoding and decoding.This namespace includes functions to safely encode and decode strings for use in HTML contexts, preventing XSS (Cross-Site Scripting) attacks.It is useful for sanitizing user input before displaying it in web pages, ensuring that special characters are properly escaped.It helps to prevent security vulnerabilities by converting characters like `<`, `>`, and `&` into their corresponding HTML entities.

**Kind**: static namespace of [<code>encode</code>](#module_encode)  

* [.html](#module_encode.html) : <code>object</code>
    * [.encode(inputString)](#module_encode.html.encode) ⇒ <code>string</code>
    * [.decode(encodedString)](#module_encode.html.decode) ⇒ <code>string</code>

<a name="module_encode.html.encode"></a>

#### html.encode(inputString) ⇒ <code>string</code>
Encodes a string for safe HTML display.

**Kind**: static method of [<code>html</code>](#module_encode.html)  
**Returns**: <code>string</code> - The HTML encoded string.  

| Param | Type | Description |
| --- | --- | --- |
| inputString | <code>string</code> | The string to encode. |

**Example**  
```js
const encoded = html.encode('<script>alert("XSS")</script>');console.log(encoded); // Outputs: &lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;
```
<a name="module_encode.html.decode"></a>

#### html.decode(encodedString) ⇒ <code>string</code>
Decodes an HTML encoded string back to its original form.

**Kind**: static method of [<code>html</code>](#module_encode.html)  
**Returns**: <code>string</code> - The decoded string.  

| Param | Type | Description |
| --- | --- | --- |
| encodedString | <code>string</code> | The HTML encoded string to decode. |

**Example**  
```js
const decoded = html.decode('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');console.log(decoded); // Outputs: <script>alert("XSS")</script>
```
<a name="module_encode.base58"></a>

### encode.base58 : <code>object</code>
Provides methods for Base58 encoding and decoding.This namespace includes functions to encode and decode strings in Base58 format, which is commonly used for data representation in applications like Bitcoin addresses.

**Kind**: static namespace of [<code>encode</code>](#module_encode)  

* [.base58](#module_encode.base58) : <code>object</code>
    * [.encode(inputBuffer)](#module_encode.base58.encode) ⇒ <code>string</code>
    * [.decode(base58String)](#module_encode.base58.decode) ⇒ <code>Buffer</code>

<a name="module_encode.base58.encode"></a>

#### base58.encode(inputBuffer) ⇒ <code>string</code>
Encodes a Buffer or string into Base58 format.

**Kind**: static method of [<code>base58</code>](#module_encode.base58)  
**Returns**: <code>string</code> - The Base58 encoded string.  

| Param | Type | Description |
| --- | --- | --- |
| inputBuffer | <code>Buffer</code> \| <code>string</code> | The data to encode. |

**Example**  
```js
const encoded = base58.encode(Buffer.from('Hello, World!'));console.log(encoded); // Outputs: 2NEpo7TZRRrLZSi2U
```
<a name="module_encode.base58.decode"></a>

#### base58.decode(base58String) ⇒ <code>Buffer</code>
Decodes a Base58 encoded string back into a Buffer.

**Kind**: static method of [<code>base58</code>](#module_encode.base58)  
**Returns**: <code>Buffer</code> - The decoded Buffer.  

| Param | Type | Description |
| --- | --- | --- |
| base58String | <code>string</code> | The Base58 string to decode. |

**Example**  
```js
const decoded = base58.decode('2NEpo7TZRRrLZSi2U');console.log(decoded.toString()); // Outputs: Hello, World!
```
<a name="module_formdata"></a>

## formdata
Provides a factory function to create FormData instances.This module is used to handle form data in HTTP requests, allowing for easy construction of multipart/form-data requests.It simplifies the process of appending fields and files to the form data, and provides a method to get headers for use with HTTP clients.It is particularly useful for uploading files and sending complex data structures in web applications.It abstracts the complexities of constructing multipart requests, making it easier to work with file uploads and form submissions.

<a name="module_formdata.create"></a>

### formdata.create() ⇒ <code>FormData</code>
Creates a new FormData instance.This function initializes a FormData object that can be used to append fields and files for HTTP requests.It provides a simple interface for constructing multipart/form-data requests, which is commonly used for file uploads and form submissions.It allows developers to easily add data to the form, including text fields and binary files,and retrieve the necessary headers for sending the form data in HTTP requests.

**Kind**: static method of [<code>formdata</code>](#module_formdata)  
**Returns**: <code>FormData</code> - A new FormData instance.  
**Example**  
```js
const form = formdata.create();form.append('name', 'Gingee App Server');form.append('description', 'This is the Gingee mascot.');form.append('image', fs.readFileSync(fs.BOX, './images/gingee.png'), 'gingee.png');const headers = form.getHeaders();
```
<a name="module_fs"></a>

## fs
A secure file system module for Gingee that provides secure sandboxed synchronous and asynchronous file operations.<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [fs](#module_fs)
    * [.BOX](#module_fs.BOX)
    * [.WEB](#module_fs.WEB)
    * [.readFileSync(scope, filePath, [options])](#module_fs.readFileSync) ⇒ <code>string</code> \| <code>Buffer</code>
    * [.readJSONSync(scope, filePath, [options])](#module_fs.readJSONSync) ⇒ <code>object</code>
    * [.writeFileSync(scope, filePath, data, [options])](#module_fs.writeFileSync) ⇒ <code>void</code>
    * [.appendFileSync(scope, filePath, data, [options])](#module_fs.appendFileSync) ⇒ <code>void</code>
    * [.writeJSONSync(scope, filePath, data, [options])](#module_fs.writeJSONSync) ⇒ <code>void</code>
    * [.existsSync(scope, filePath)](#module_fs.existsSync) ⇒ <code>boolean</code>
    * [.deleteFileSync(scope, filePath)](#module_fs.deleteFileSync) ⇒ <code>void</code>
    * [.moveFileSync(sourceScope, sourcePath, destScope, destPath)](#module_fs.moveFileSync) ⇒ <code>string</code>
    * [.copyFileSync(sourceScope, sourcePath, destScope, destPath)](#module_fs.copyFileSync) ⇒ <code>void</code>
    * [.mkdirSync(scope, dirPath)](#module_fs.mkdirSync) ⇒ <code>void</code>
    * [.rmdirSync(scope, dirPath, [options])](#module_fs.rmdirSync) ⇒ <code>void</code>
    * [.moveDirSync(sourceScope, sourcePath, destScope, destPath)](#module_fs.moveDirSync) ⇒ <code>string</code>
    * [.copyDirSync(sourceScope, sourcePath, destScope, destPath)](#module_fs.copyDirSync) ⇒ <code>void</code>
    * [.readFile(scope, filePath, [options])](#module_fs.readFile) ⇒ <code>Promise.&lt;(string\|Buffer)&gt;</code>
    * [.writeFile(scope, filePath, data, [options])](#module_fs.writeFile) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.appendFile(scope, filePath, data, [options])](#module_fs.appendFile) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.exists(scope, filePath)](#module_fs.exists) ⇒ <code>Promise.&lt;boolean&gt;</code>
    * [.deleteFile(scope, filePath)](#module_fs.deleteFile) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.moveFile(sourceScope, sourcePath, destScope, destPath)](#module_fs.moveFile) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.copyFile(sourceScope, sourcePath, destScope, destPath)](#module_fs.copyFile) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.mkdir(scope, dirPath)](#module_fs.mkdir) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.rmdir(scope, dirPath, [options])](#module_fs.rmdir) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.moveDir(sourceScope, sourcePath, destScope, destPath)](#module_fs.moveDir) ⇒ <code>Promise.&lt;string&gt;</code>
    * [.copyDir(sourceScope, sourcePath, destScope, destPath)](#module_fs.copyDir) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="module_fs.BOX"></a>

### fs.BOX
Constant for the BOX scope.This constant can be used to specify the BOX scope when working with file system operations.It represents the application box directory, typically used for sandboxed data and server scripts that should not be accessible from the web.

**Kind**: static constant of [<code>fs</code>](#module_fs)  
<a name="module_fs.WEB"></a>

### fs.WEB
Constant for the WEB scope.This constant can be used to specify the WEB scope when working with file system operations.It represents the web directory, typically used for web assets.

**Kind**: static constant of [<code>fs</code>](#module_fs)  
<a name="module_fs.readFileSync"></a>

### fs.readFileSync(scope, filePath, [options]) ⇒ <code>string</code> \| <code>Buffer</code>
Synchronously reads the entire contents of a file.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>string</code> \| <code>Buffer</code> - The contents of the file.  
**Throws**:

- <code>Error</code> If the file does not exist or is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
const content = fs.readFileSync(fs.BOX, 'data/myfile.txt', 'utf8');console.log(content); // Outputs the content of myfile.txt
```
<a name="module_fs.readJSONSync"></a>

### fs.readJSONSync(scope, filePath, [options]) ⇒ <code>object</code>
Synchronously reads a JSON file and parses it.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>object</code> - The parsed JSON object.  
**Throws**:

- <code>Error</code> If the file does not exist or is outside the secure scope or it is not valid JSON.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
const data = fs.readJSONSync(fs.BOX, 'data/myfile.json');console.log(data); // Outputs the parsed JSON object
```
<a name="module_fs.writeFileSync"></a>

### fs.writeFileSync(scope, filePath, data, [options]) ⇒ <code>void</code>
Synchronously writes data to a file, creating directories as needed.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| data | <code>string</code> \| <code>Buffer</code> | The data to write to the file. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.writeFileSync(fs.BOX, 'data/myfile.txt', 'Hello, World!', 'utf8');
```
<a name="module_fs.appendFileSync"></a>

### fs.appendFileSync(scope, filePath, data, [options]) ⇒ <code>void</code>
Synchronously appends data to a file, creating directories as needed.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| data | <code>string</code> \| <code>Buffer</code> | The data to append to the file. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.appendFileSync(fs.BOX, 'data/myfile.txt', 'Hello, World!', 'utf8');
```
<a name="module_fs.writeJSONSync"></a>

### fs.writeJSONSync(scope, filePath, data, [options]) ⇒ <code>void</code>
Synchronously writes a JSON object to a file, creating directories as needed.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| data | <code>object</code> | The JSON object to write to the file. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.writeJSONSync(fs.BOX, 'data/myfile.json', { key: 'value' });
```
<a name="module_fs.existsSync"></a>

### fs.existsSync(scope, filePath) ⇒ <code>boolean</code>
Synchronously checks if a file exists.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>boolean</code> - True if the file exists, false otherwise.  

| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |

**Example**  
```js
const exists = fs.existsSync(fs.BOX, 'data/myfile.txt');console.log(exists); // Outputs true if myfile.txt exists, false otherwise
```
<a name="module_fs.deleteFileSync"></a>

### fs.deleteFileSync(scope, filePath) ⇒ <code>void</code>
Synchronously deletes a file.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the file does not exist or is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |

**Example**  
```js
fs.deleteFileSync(fs.BOX, 'data/myfile.txt');
```
<a name="module_fs.moveFileSync"></a>

### fs.moveFileSync(sourceScope, sourcePath, destScope, destPath) ⇒ <code>string</code>
Synchronously moves a file from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>string</code> - The new absolute path of the moved file.  
**Throws**:

- <code>Error</code> if the source file does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source file (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source file, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination file (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination file, relative to the destination scope. |

**Example**  
```js
const newPath = fs.moveFileSync(fs.BOX, 'data/myfile.txt', fs.BOX, 'data/archived/myfile.txt');
```
<a name="module_fs.copyFileSync"></a>

### fs.copyFileSync(sourceScope, sourcePath, destScope, destPath) ⇒ <code>void</code>
Synchronously copies a file from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> if the source file does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source file (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source file, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination file (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination file, relative to the destination scope. |

**Example**  
```js
fs.copyFileSync(fs.BOX, 'data/myfile.txt', fs.BOX, 'data/backup/myfile.txt');
```
<a name="module_fs.mkdirSync"></a>

### fs.mkdirSync(scope, dirPath) ⇒ <code>void</code>
Synchronously creates a directory and its parent directories if they do not exist.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the directory path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| dirPath | <code>string</code> | The path to the directory, relative to the scope or script. |

**Example**  
```js
fs.mkdirSync(fs.BOX, 'data/newdir');
```
<a name="module_fs.rmdirSync"></a>

### fs.rmdirSync(scope, dirPath, [options]) ⇒ <code>void</code>
Synchronously removes a directory.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> If the directory is not empty and `recursive` is false.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| dirPath | <code>string</code> | The path to the directory, relative to the scope or script. |
| [options] | <code>object</code> | Options for the removal.   - `recursive`: If true, removes the directory and its contents recursively. |

**Example**  
```js
fs.rmdirSync(fs.BOX, 'data/oldDir', { recursive: true });
```
<a name="module_fs.moveDirSync"></a>

### fs.moveDirSync(sourceScope, sourcePath, destScope, destPath) ⇒ <code>string</code>
Synchronously moves a directory from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>string</code> - The new absolute path of the moved directory.  
**Throws**:

- <code>Error</code> if the source directory does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source directory (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source directory, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination directory (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination directory, relative to the destination scope. |

**Example**  
```js
fs.moveDirSync(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir');
```
<a name="module_fs.copyDirSync"></a>

### fs.copyDirSync(sourceScope, sourcePath, destScope, destPath) ⇒ <code>void</code>
Synchronously copies a directory from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Throws**:

- <code>Error</code> if the source directory does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source directory (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source directory, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination directory (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination directory, relative to the destination scope. |

**Example**  
```js
fs.copyDirSync(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir');
```
<a name="module_fs.readFile"></a>

### fs.readFile(scope, filePath, [options]) ⇒ <code>Promise.&lt;(string\|Buffer)&gt;</code>
Asynchronously reads the entire contents of a file.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;(string\|Buffer)&gt;</code> - A Promise that resolves with the contents of the file.  
**Throws**:

- <code>Error</code> If the file does not exist or is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.readFile(fs.BOX, 'data/file.txt', 'utf8').then(contents => {  console.log(contents);});
```
<a name="module_fs.writeFile"></a>

### fs.writeFile(scope, filePath, data, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously writes data to a file, replacing the file if it already exists.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the write operation is complete.  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| data | <code>string</code> \| <code>Buffer</code> | The data to write. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.writeFile(fs.BOX, 'data/file.txt', 'Hello, world!', 'utf8').then(() => {  console.log('File written successfully');});
```
<a name="module_fs.appendFile"></a>

### fs.appendFile(scope, filePath, data, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously appends data to a file, creating directories as needed.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the append operation is complete.  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |
| data | <code>string</code> \| <code>Buffer</code> | The data to append. |
| [options] | <code>object</code> \| <code>string</code> | The encoding or an options object. |

**Example**  
```js
fs.appendFile(fs.BOX, 'data/file.txt', 'Hello, world!', 'utf8').then(() => {  console.log('File appended successfully');});
```
<a name="module_fs.exists"></a>

### fs.exists(scope, filePath) ⇒ <code>Promise.&lt;boolean&gt;</code>
Asynchronously checks if a file exists.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A Promise that resolves with true if the file exists, false otherwise.  
**Throws**:

- <code>Error</code> If the file path is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |

**Example**  
```js
fs.exists(fs.BOX, 'data/file.txt').then(exists => {  console.log(exists);});
```
<a name="module_fs.deleteFile"></a>

### fs.deleteFile(scope, filePath) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously deletes a file.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the file is deleted.  
**Throws**:

- <code>Error</code> If the file does not exist or is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the file, relative to the scope or script. |

**Example**  
```js
fs.deleteFile(fs.BOX, 'data/file.txt').then(() => {  console.log('File deleted successfully');});
```
<a name="module_fs.moveFile"></a>

### fs.moveFile(sourceScope, sourcePath, destScope, destPath) ⇒ <code>Promise.&lt;string&gt;</code>
Asynchronously moves a file from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;string&gt;</code> - A Promise that resolves with the new absolute path of the moved file.  
**Throws**:

- <code>Error</code> If the source and destination scopes are different.
- <code>Error</code> If the source file does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source file (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source file, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination file (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination file, relative to the destination scope. |

**Example**  
```js
fs.moveFile(fs.BOX, 'data/file.txt', fs.BOX, 'data/newfile.txt').then(newPath => {  console.log('File moved to:', newPath);});
```
<a name="module_fs.copyFile"></a>

### fs.copyFile(sourceScope, sourcePath, destScope, destPath) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously copies a file from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the file is copied.  
**Throws**:

- <code>Error</code> if the source file does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source file (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source file, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination file (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination file, relative to the destination scope. |

**Example**  
```js
fs.copyFile(fs.BOX, 'data/file.txt', fs.BOX, 'data/copy.txt').then(() => {  console.log('File copied successfully');});
```
<a name="module_fs.mkdir"></a>

### fs.mkdir(scope, dirPath) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously creates a directory and its parent directories if they do not exist.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the directory is created.  
**Throws**:

- <code>Error</code> If the directory path is outside the secure scope or if the directory cannot be created.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| dirPath | <code>string</code> | The path to the directory, relative to the scope or script. |

**Example**  
```js
fs.mkdir(fs.BOX, 'data/newdir').then(() => {  console.log('Directory created successfully');});
```
<a name="module_fs.rmdir"></a>

### fs.rmdir(scope, dirPath, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously removes a directory.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the directory is removed.  
**Throws**:

- <code>Error</code> If the directory does not exist or is outside the secure scope.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| dirPath | <code>string</code> | The path to the directory, relative to the scope or script. |
| [options] | <code>object</code> | Options for the removal.  - `recursive`: If true, removes the directory and its contents recursively. |

**Example**  
```js
fs.rmdir(fs.BOX, 'data/oldDir', { recursive: true }).then(() => {  console.log('Directory removed successfully');});
```
<a name="module_fs.moveDir"></a>

### fs.moveDir(sourceScope, sourcePath, destScope, destPath) ⇒ <code>Promise.&lt;string&gt;</code>
Asynchronously moves a directory from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;string&gt;</code> - A Promise that resolves with the new absolute path of the moved directory.  
**Throws**:

- <code>Error</code> if the source directory does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source directory (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source directory, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination directory (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination directory, relative to the destination scope. |

**Example**  
```js
fs.moveDir(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir').then(newPath => {  console.log('Directory moved to:', newPath);});
```
<a name="module_fs.copyDir"></a>

### fs.copyDir(sourceScope, sourcePath, destScope, destPath) ⇒ <code>Promise.&lt;void&gt;</code>
Asynchronously copies a directory from one location to another within the same scope.

**Kind**: static method of [<code>fs</code>](#module_fs)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A Promise that resolves when the directory is copied.  
**Throws**:

- <code>Error</code> if the source directory does not exist.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source directory (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source directory, relative to the source scope. |
| destScope | <code>string</code> | The scope of the destination directory (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination directory, relative to the destination scope. |

**Example**  
```js
fs.copyDir(fs.BOX, 'data/oldDir', fs.BOX, 'data/newDir').then(() => {  console.log('Directory copied successfully');});
```
<a name="module_html"></a>

## html
A module for parsing and manipulating HTML using [Cheerio](https://cheerio.js.org/).It provides functions to load HTML from strings, files, and URLs, allowing for easy querying and manipulation of HTML documents.This module is particularly useful for web scraping, data extraction, and HTML manipulation tasks in Gingee applications.It abstracts the complexities of working with raw HTML, providing a simple and consistent API for developers.It leverages the Cheerio library to provide a jQuery-like syntax for traversing and manipulating the HTML structure.It supports both synchronous and asynchronous operations, making it flexible for various use cases.


* [html](#module_html)
    * [.fromString(htmlString)](#module_html.fromString) ⇒ <code>cheerio.CheerioAPI</code>
    * [.fromFile(scope, filePath)](#module_html.fromFile) ⇒ <code>Promise.&lt;cheerio.CheerioAPI&gt;</code>
    * [.fromFileSync(scope, filePath)](#module_html.fromFileSync) ⇒ <code>cheerio.CheerioAPI</code>
    * [.fromUrl(url, [options])](#module_html.fromUrl) ⇒ <code>Promise.&lt;cheerio.CheerioAPI&gt;</code>

<a name="module_html.fromString"></a>

### html.fromString(htmlString) ⇒ <code>cheerio.CheerioAPI</code>
Parses an HTML document from a string.This function takes a raw HTML string and returns a Cheerio instance for querying and manipulating the HTML content.It is useful for scenarios where HTML content is dynamically generated or fetched from an external source.

**Kind**: static method of [<code>html</code>](#module_html)  
**Returns**: <code>cheerio.CheerioAPI</code> - The Cheerio instance for querying.  
**Throws**:

- <code>Error</code> If the input is not a string.


| Param | Type | Description |
| --- | --- | --- |
| htmlString | <code>string</code> | The raw HTML content to parse. |

**Example**  
```js
const $ = html.fromString('<div class="test">Hello, World!</div>');console.log($('.test').text()); // Outputs: Hello, World!
```
<a name="module_html.fromFile"></a>

### html.fromFile(scope, filePath) ⇒ <code>Promise.&lt;cheerio.CheerioAPI&gt;</code>
Reads and parses an HTML file from the secure filesystem.This function allows you to load HTML content from a file, ensuring that the file is read securely within the Gingee environment.It uses the secure file system module to read the file content and then parses it into a Cheerio instance.This is particularly useful for applications that need to manipulate or query HTML files stored in the Gingee filesystem.It abstracts the file reading process, providing a simple interface to work with HTML files.

**Kind**: static method of [<code>html</code>](#module_html)  
**Returns**: <code>Promise.&lt;cheerio.CheerioAPI&gt;</code> - A Promise that resolves to the Cheerio instance.  
**Throws**:

- <code>Error</code> If the file cannot be read or parsed.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the HTML file. |

**Example**  
```js
const $ = await html.fromFile(fs.BOX, 'data/myfile.html');console.log($('.test').text()); // Outputs the text content of the .test element
```
<a name="module_html.fromFileSync"></a>

### html.fromFileSync(scope, filePath) ⇒ <code>cheerio.CheerioAPI</code>
Synchronously reads and parses an HTML file from the secure filesystem.This function allows you to load HTML content from a file in a synchronous manner, ensuring that the file is read securely within the Gingee environment.It uses the secure file system module to read the file content and then parses it into a Cheerio instance.This is particularly useful for applications that need to manipulate or query HTML files stored in the Gingee filesystem in a synchronous context.It abstracts the file reading process, providing a simple interface to work with HTML files.

**Kind**: static method of [<code>html</code>](#module_html)  
**Returns**: <code>cheerio.CheerioAPI</code> - The Cheerio instance for querying.  
**Throws**:

- <code>Error</code> If the file cannot be read or parsed.


| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to operate in (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The path to the HTML file. |

**Example**  
```js
const $ = html.fromFileSync(fs.BOX, 'data/myfile.html');console.log($('.test').text()); // Outputs the text content of the .test element
```
<a name="module_html.fromUrl"></a>

### html.fromUrl(url, [options]) ⇒ <code>Promise.&lt;cheerio.CheerioAPI&gt;</code>
Asynchronously fetches and parses an HTML document from a URL.This function retrieves HTML content from a specified URL and returns a Cheerio instance for querying and manipulating the HTML.It is useful for web scraping, data extraction, and any scenario where you need to work with HTML content from the web.It abstracts the complexities of making HTTP requests and parsing the response, providing a simple interface for developers.It ensures that the response is of the correct content type (text/html) before parsing. It supports only url with response of content type - 'text/html'.

**Kind**: static method of [<code>html</code>](#module_html)  
**Returns**: <code>Promise.&lt;cheerio.CheerioAPI&gt;</code> - A Promise that resolves to the Cheerio instance.  
**Throws**:

- <code>Error</code> If the response is not of type 'text/html' or if the HTML cannot be parsed.


| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL of the webpage to scrape. |
| [options] | <code>object</code> | Options to be passed for the http call (like request headers). |

**Example**  
```js
const $ = await html.fromUrl('https://example.com');console.log($('.test').text()); // Outputs the text content of the .test element
```
<a name="module_httpclient"></a>

## httpclient
A module for making HTTP requests in Gingee applications.This module provides functions to perform GET and POST requests, supporting various content types.It abstracts the complexities of making HTTP requests, providing a simple interface for developers to interact with web services.It supports both text and binary responses, automatically determining the response type based on the content-type header.It is particularly useful for applications that need to fetch resources from external APIs or web services, and for sending data to web services in different formats.It allows for flexible data submission, making it suitable for APIs that require different content types.It provides constants for common POST data types, ensuring that the correct headers are set for the request.<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [httpclient](#module_httpclient)
    * [.JSON](#module_httpclient.JSON)
    * [.FORM](#module_httpclient.FORM)
    * [.TEXT](#module_httpclient.TEXT)
    * [.XML](#module_httpclient.XML)
    * [.MULTIPART](#module_httpclient.MULTIPART)
    * [.get(url, [options])](#module_httpclient.get) ⇒ <code>Promise.&lt;{status: number, headers: object, body: (string\|Buffer)}&gt;</code>
    * [.post(url, body, [options])](#module_httpclient.post) ⇒ <code>Promise.&lt;{status: number, headers: object, body: (string\|Buffer)}&gt;</code>

<a name="module_httpclient.JSON"></a>

### httpclient.JSON
Constant for JSON content type in POST requests.This constant can be used to specify that the POST request body is in JSON format.

**Kind**: static constant of [<code>httpclient</code>](#module_httpclient)  
<a name="module_httpclient.FORM"></a>

### httpclient.FORM
Constant for form-urlencoded content type in POST requests.This constant can be used to specify that the POST request body is in form-urlencoded format.

**Kind**: static constant of [<code>httpclient</code>](#module_httpclient)  
<a name="module_httpclient.TEXT"></a>

### httpclient.TEXT
Constant for plain text content type in POST requests.This constant can be used to specify that the POST request body is in plain text format.

**Kind**: static constant of [<code>httpclient</code>](#module_httpclient)  
<a name="module_httpclient.XML"></a>

### httpclient.XML
Constant for XML content type in POST requests.This constant can be used to specify that the POST request body is in XML format.

**Kind**: static constant of [<code>httpclient</code>](#module_httpclient)  
<a name="module_httpclient.MULTIPART"></a>

### httpclient.MULTIPART
Constant for multipart/form-data content type in POST requests.This constant can be used to specify that the POST request body is in multipart/form-data format.

**Kind**: static constant of [<code>httpclient</code>](#module_httpclient)  
<a name="module_httpclient.get"></a>

### httpclient.get(url, [options]) ⇒ <code>Promise.&lt;{status: number, headers: object, body: (string\|Buffer)}&gt;</code>
Performs an HTTP GET request.This function retrieves data from a specified URL and returns the response status, headers, and body.It supports both text and binary responses, automatically determining the response type based on the content-type header.It abstracts the complexities of making HTTP requests, providing a simple interface for developers to fetch data from the web.It can handle various content types, including JSON, text, and binary data, making it versatile for different use cases.It is particularly useful for applications that need to fetch resources from external APIs or web services.

**Kind**: static method of [<code>httpclient</code>](#module_httpclient)  
**Throws**:

- <code>Error</code> If the request fails or if the response body cannot be processed.


| Param | Type | Description |
| --- | --- | --- |
| url | <code>string</code> | The URL to request. |
| [options] | <code>object</code> | Axios request configuration options (e.g., headers). |

**Example**  
```js
const response = await httpclient.get('https://api.example.com/data');console.log(response.body);
```
<a name="module_httpclient.post"></a>

### httpclient.post(url, body, [options]) ⇒ <code>Promise.&lt;{status: number, headers: object, body: (string\|Buffer)}&gt;</code>
Performs an HTTP POST request.This function sends data to a specified URL and returns the response status, headers, and body.It supports various content types, including JSON, form-urlencoded, plain text, XML, and multipart/form-data.It abstracts the complexities of making HTTP POST requests, providing a simple interface for developers to send data to web services.It allows for flexible data submission, making it suitable for APIs that require different content types.

**Kind**: static method of [<code>httpclient</code>](#module_httpclient)  
**Throws**:

- <code>Error</code> If the request fails or if the body cannot be processed.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| url | <code>string</code> |  | The URL to post to. |
| body | <code>any</code> |  | The data to send in the request body. |
| [options] | <code>object</code> |  | Axios request configuration options. |
| [options.postType] | <code>string</code> | <code>&quot;httpclient.JSON&quot;</code> | The type of data being posted. |

**Example**  
```js
const response = await httpclient.post('https://api.example.com/data', { key: 'value' });console.log(response.body);
```
<a name="module_image"></a>

## image
A module for image processing using the [Sharp](https://sharp.pixelplumbing.com/) library.It provides a simple and secure way to manipulate images, including resizing, rotating, flipping, and more.<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [image](#module_image)
    * _static_
        * [.loadFromFile(filePath)](#module_image.loadFromFile) ⇒ <code>ImageProcessor</code>
        * [.loadFromBuffer(buffer)](#module_image.loadFromBuffer) ⇒ <code>ImageProcessor</code>
    * _inner_
        * [~ImageProcessor](#module_image..ImageProcessor)
            * [new ImageProcessor(sharpInstance)](#new_module_image..ImageProcessor_new)
            * [.resize(options)](#module_image..ImageProcessor+resize) ⇒ <code>ImageProcessor</code>
            * [.rotate(angle)](#module_image..ImageProcessor+rotate) ⇒ <code>ImageProcessor</code>
            * [.flip()](#module_image..ImageProcessor+flip) ⇒ <code>ImageProcessor</code>
            * [.flop()](#module_image..ImageProcessor+flop) ⇒ <code>ImageProcessor</code>
            * [.greyscale()](#module_image..ImageProcessor+greyscale) ⇒ <code>ImageProcessor</code>
            * [.blur(sigma)](#module_image..ImageProcessor+blur) ⇒ <code>ImageProcessor</code>
            * [.sharpen()](#module_image..ImageProcessor+sharpen) ⇒ <code>ImageProcessor</code>
            * [.composite(watermarkBuffer, options)](#module_image..ImageProcessor+composite) ⇒ <code>ImageProcessor</code>
            * [.format(format, [options])](#module_image..ImageProcessor+format) ⇒ <code>ImageProcessor</code>
            * [.toBuffer()](#module_image..ImageProcessor+toBuffer) ⇒ <code>Promise.&lt;Buffer&gt;</code>
            * [.toFile(scope, filePath)](#module_image..ImageProcessor+toFile) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="module_image.loadFromFile"></a>

### image.loadFromFile(filePath) ⇒ <code>ImageProcessor</code>
Loads an image from a Buffer or a file path.This function initializes an ImageProcessor instance with the provided image data.It supports both Buffer inputs (for in-memory images) and file paths (for images stored on disk).It abstracts the complexities of loading images, providing a simple interface for developers to work with images.It allows for flexible image processing workflows, enabling developers to chain multiple operations on the image.

**Kind**: static method of [<code>image</code>](#module_image)  
**Returns**: <code>ImageProcessor</code> - A new instance of our ImageProcessor for chaining operations.  
**Throws**:

- <code>Error</code> If the input is not a Buffer or a valid file path.


| Param | Type | Description |
| --- | --- | --- |
| filePath | <code>string</code> | a file path to an image file. |

**Example**  
```js
const image = require('image');const processor = image.load(fs.BOX, './images/gingee.png');processor.resize({ width: 200, height: 200 }).greyscale().toFile(fs.WEB, 'output/processed_image.webp');
```
<a name="module_image.loadFromBuffer"></a>

### image.loadFromBuffer(buffer) ⇒ <code>ImageProcessor</code>
Loads an image from a Buffer.This function initializes an ImageProcessor instance with the provided image data.

**Kind**: static method of [<code>image</code>](#module_image)  
**Returns**: <code>ImageProcessor</code> - A new instance of our ImageProcessor for chaining operations.  
**Throws**:

- <code>Error</code> If the input is not a Buffer.


| Param | Type | Description |
| --- | --- | --- |
| buffer | <code>Buffer</code> | A Buffer containing image data. |

**Example**  
```js
const image = require('image');const processor = image.loadFromBuffer(buffer);processor.resize({ width: 200, height: 200 }).greyscale().toFile(fs.WEB, 'output/processed_image.webp');
```
<a name="module_image..ImageProcessor"></a>

### image~ImageProcessor
A secure wrapper class for the  [Sharp](https://sharp.pixelplumbing.com/) image processing library.Each method returns 'this' to allow for a fluent, chainable API. This class cannot be directly instantiated.Instead, use the `load` function of the Image module to create an instance with an image loaded from a Buffer or a file path.This class abstracts the complexities of image processing, providing a simple interface for developers to work with images.It allows for flexible image manipulation workflows, enabling developers to chain multiple operations on the image.<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.

**Kind**: inner class of [<code>image</code>](#module_image)  

* [~ImageProcessor](#module_image..ImageProcessor)
    * [new ImageProcessor(sharpInstance)](#new_module_image..ImageProcessor_new)
    * [.resize(options)](#module_image..ImageProcessor+resize) ⇒ <code>ImageProcessor</code>
    * [.rotate(angle)](#module_image..ImageProcessor+rotate) ⇒ <code>ImageProcessor</code>
    * [.flip()](#module_image..ImageProcessor+flip) ⇒ <code>ImageProcessor</code>
    * [.flop()](#module_image..ImageProcessor+flop) ⇒ <code>ImageProcessor</code>
    * [.greyscale()](#module_image..ImageProcessor+greyscale) ⇒ <code>ImageProcessor</code>
    * [.blur(sigma)](#module_image..ImageProcessor+blur) ⇒ <code>ImageProcessor</code>
    * [.sharpen()](#module_image..ImageProcessor+sharpen) ⇒ <code>ImageProcessor</code>
    * [.composite(watermarkBuffer, options)](#module_image..ImageProcessor+composite) ⇒ <code>ImageProcessor</code>
    * [.format(format, [options])](#module_image..ImageProcessor+format) ⇒ <code>ImageProcessor</code>
    * [.toBuffer()](#module_image..ImageProcessor+toBuffer) ⇒ <code>Promise.&lt;Buffer&gt;</code>
    * [.toFile(scope, filePath)](#module_image..ImageProcessor+toFile) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="new_module_image..ImageProcessor_new"></a>

#### new ImageProcessor(sharpInstance)
Creates a new ImageProcessor instance.


| Param | Description |
| --- | --- |
| sharpInstance | An instance of the sharp image processing library. |

<a name="module_image..ImageProcessor+resize"></a>

#### imageProcessor.resize(options) ⇒ <code>ImageProcessor</code>
Resizes the image to the specified dimensions.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The resize options. |
| options.width | <code>number</code> | The new width of the image. |
| options.height | <code>number</code> | The new height of the image. |

**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.resize({ width: 200, height: 200, fit: 'contain', background: '#FFFFFF' });
```
<a name="module_image..ImageProcessor+rotate"></a>

#### imageProcessor.rotate(angle) ⇒ <code>ImageProcessor</code>
Rotates the image by the specified angle.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| angle | <code>number</code> | <code>0</code> | The angle to rotate the image (in degrees). |

**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.rotate(90);
```
<a name="module_image..ImageProcessor+flip"></a>

#### imageProcessor.flip() ⇒ <code>ImageProcessor</code>
Flips the image horizontally.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  
**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.flip();
```
<a name="module_image..ImageProcessor+flop"></a>

#### imageProcessor.flop() ⇒ <code>ImageProcessor</code>
Flips the image vertically.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  
**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.flop();
```
<a name="module_image..ImageProcessor+greyscale"></a>

#### imageProcessor.greyscale() ⇒ <code>ImageProcessor</code>
Converts the image to greyscale.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  
**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.greyscale();
```
<a name="module_image..ImageProcessor+blur"></a>

#### imageProcessor.blur(sigma) ⇒ <code>ImageProcessor</code>
Applies a blur effect to the image.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  

| Param | Type | Description |
| --- | --- | --- |
| sigma | <code>number</code> | The blur amount (higher values = more blur). |

**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.blur(5);
```
<a name="module_image..ImageProcessor+sharpen"></a>

#### imageProcessor.sharpen() ⇒ <code>ImageProcessor</code>
Sharpens the image.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  
**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.sharpen();
```
<a name="module_image..ImageProcessor+composite"></a>

#### imageProcessor.composite(watermarkBuffer, options) ⇒ <code>ImageProcessor</code>
Composites another image onto this one.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| watermarkBuffer | <code>Buffer</code> |  | The image buffer to composite. |
| options | <code>object</code> |  | The options for compositing. |
| [options.left] | <code>number</code> | <code>0</code> | The x-coordinate to place the watermark. |
| [options.top] | <code>number</code> | <code>0</code> | The y-coordinate to place the watermark. |
| [options.opacity] | <code>number</code> | <code>1</code> | The opacity of the watermark |

**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.composite(watermarkBuffer, { left: 10, top: 10, opacity: 0.5 });
```
<a name="module_image..ImageProcessor+format"></a>

#### imageProcessor.format(format, [options]) ⇒ <code>ImageProcessor</code>
Converts the image to a specific format.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Returns**: <code>ImageProcessor</code> - The ImageProcessor instance for chaining.  

| Param | Type | Description |
| --- | --- | --- |
| format | <code>string</code> | The format to convert to (e.g., 'jpeg', 'png', 'webp'). |
| [options] | <code>object</code> | Options for the format conversion (see sharp documentation). |

**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.format('jpeg', { quality: 80 });
```
<a name="module_image..ImageProcessor+toBuffer"></a>

#### imageProcessor.toBuffer() ⇒ <code>Promise.&lt;Buffer&gt;</code>
Processes the image and returns the final data as a Buffer.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  
**Example**  
```js
const processor = image.load(fs.BOX, '/images/gingee.png');processor.resize({ width: 200, height: 200 });const buffer = await processor.toBuffer();
```
<a name="module_image..ImageProcessor+toFile"></a>

#### imageProcessor.toFile(scope, filePath) ⇒ <code>Promise.&lt;void&gt;</code>
Processes the image and saves it to a file using our secure fs module.

**Kind**: instance method of [<code>ImageProcessor</code>](#module_image..ImageProcessor)  

| Param | Type | Description |
| --- | --- | --- |
| scope | <code>string</code> | The scope to save to (fs.BOX or fs.WEB). |
| filePath | <code>string</code> | The destination file path. |

**Example**  
```js
// path with leading slash indicates path from scope root, // path without leading slash indicates path relative to the executing script// here image is loaded from <project>/<app_name>/<box>/images/gingee.png// image is and saved to <project>/<app_name>/output/processed_image.webpconst processor = image.load(fs.BOX, '/images/gingee.png');processor.resize({ width: 200, height: 200 });await processor.toFile(fs.WEB, '/output/processed_image.webp');
```
<a name="module_pdf"></a>

## pdf
This module provides functionality to create PDF documents using pdfmake.It includes a default font configuration with Roboto and a function to create PDFs from document definitions.It is designed to be used in a secure environment, ensuring that only allowed fonts are registered.<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.

<a name="module_pdf.create"></a>

### pdf.create(documentDefinition) ⇒ <code>Promise.&lt;Buffer&gt;</code>
Creates a PDF document from a document definition object.

**Kind**: static method of [<code>pdf</code>](#module_pdf)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - A promise that resolves with the PDF data as a Buffer.  
**Throws**:

- <code>Error</code> If there is an issue creating the PDF document.


| Param | Type | Description |
| --- | --- | --- |
| documentDefinition | <code>object</code> | A standard pdfmake document definition object. |

**Example**  
```js
const pdf = require('pdf');const docDefinition = {    pageSize: 'LETTER',    pageMargins: [40, 60, 40, 60],    header: { text: 'Gingee Weekly Report', alignment: 'center', margin: [0, 20, 0, 0] },    content: [        { text: 'Hello, World!', fontSize: 15 }    ]};const pdfBuffer = await pdf.create(docDefinition);const fileName = `report-${Date.now()}.pdf`;$g.response.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;$g.response.send(pdfBuffer, 200, 'application/pdf');
```
<a name="module_platform"></a>

## platform
A module for Gingee platform-specific utilities and functions. Ideally used by only platform-level apps. To use this module the app needs to be declared in the `privilegedApps` list in the gingee.json server config.<b>IMPORTANT:</b> Requires privileged app config and explicit permission to use the module. See docs/permissions-guide for more details.


* [platform](#module_platform)
    * _static_
        * [.listApps()](#module_platform.listApps) ⇒ <code>Array.&lt;string&gt;</code>
        * [.createAppDirectory(appName)](#module_platform.createAppDirectory) ⇒ <code>object</code>
        * [.writeFile(appName, relativePath, content)](#module_platform.writeFile) ⇒ <code>boolean</code>
        * [.readFile(appName, relativePath, [encoding])](#module_platform.readFile) ⇒ <code>string</code> \| <code>Buffer</code>
        * [.registerNewApp(appName)](#module_platform.registerNewApp) ⇒ <code>object</code>
        * [.reloadApp(appName)](#module_platform.reloadApp) ⇒ <code>boolean</code>
        * [.deleteApp(appName)](#module_platform.deleteApp) ⇒ <code>boolean</code>
        * [.unzipToApp(appName, relativePath, zipBuffer)](#module_platform.unzipToApp) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.zipApp(appName)](#module_platform.zipApp) ⇒ <code>Promise.&lt;Buffer&gt;</code>
        * [.packageApp(appName)](#module_platform.packageApp) ⇒ <code>Promise.&lt;Buffer&gt;</code>
        * [.mockUpgrade(appName, packageBuffer)](#module_platform.mockUpgrade) ⇒ <code>Promise.&lt;object&gt;</code>
        * [.listBackups(appName)](#module_platform.listBackups) ⇒ <code>Array.&lt;string&gt;</code>
        * [.mockRollback(appName)](#module_platform.mockRollback) ⇒ <code>Promise.&lt;object&gt;</code>
        * [.installApp(appName, packageBuffer, permissions)](#module_platform.installApp) ⇒ <code>Promise.&lt;object&gt;</code>
        * [.upgradeApp(appName, packageBuffer, permissions, [options])](#module_platform.upgradeApp) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.rollbackApp(appName, grantedPermissions)](#module_platform.rollbackApp) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [.installFromBackup(appName, [backupVersion])](#module_platform.installFromBackup) ⇒ <code>Promise.&lt;object&gt;</code>
    * _inner_
        * [~getAppPermissions(appName)](#module_platform..getAppPermissions) ⇒ <code>Promise.&lt;object&gt;</code>
        * [~setAppPermissions(appName, permissionsArray, [reload])](#module_platform..setAppPermissions) ⇒ <code>Promise.&lt;object&gt;</code>
        * [~removeAppPermissions(appName)](#module_platform..removeAppPermissions) ⇒ <code>Promise.&lt;boolean&gt;</code>
        * [~analyzeAppBackup(appName)](#module_platform..analyzeAppBackup) ⇒ <code>Promise.&lt;object&gt;</code>

<a name="module_platform.listApps"></a>

### platform.listApps() ⇒ <code>Array.&lt;string&gt;</code>
Lists the names of all detected applications.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Array.&lt;string&gt;</code> - An array of app names.  
**Example**  
```js
const platform = require('platform');const apps = platform.listApps();console.log(apps); // ['app1', 'app2', ...]
```
<a name="module_platform.createAppDirectory"></a>

### platform.createAppDirectory(appName) ⇒ <code>object</code>
Creates a new application directory structure.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>object</code> - An object confirming the paths created.  
**Throws**:

- <code>Error</code> If the app name is invalid or if the app already exists.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the new app to create. |

**Example**  
```js
const result = platform.createAppDirectory('newApp');console.log(result); // { message: 'App "newApp" created successfully.', appPath: '/path/to/newApp', boxPath: '/path/to/newApp/box' }
```
<a name="module_platform.writeFile"></a>

### platform.writeFile(appName, relativePath, content) ⇒ <code>boolean</code>
Writes content to a file within a specified app's directory.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>boolean</code> - True if the file was written successfully.  
**Throws**:

- <code>Error</code> If the app does not exist or if the path is invalid.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The target application. |
| relativePath | <code>string</code> | The path within the app (e.g., 'box/api/test.js'). |
| content | <code>string</code> \| <code>Buffer</code> | The content to write. |

**Example**  
```js
const result = platform.writeFile('myApp', 'box/api/test.js', 'console.log("Hello World");');console.log(result); // true
```
<a name="module_platform.readFile"></a>

### platform.readFile(appName, relativePath, [encoding]) ⇒ <code>string</code> \| <code>Buffer</code>
Reads the content of a file from a specified app's directory.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>string</code> \| <code>Buffer</code> - The content of the file.  
**Throws**:

- <code>Error</code> If the app does not exist or if the file does not exist.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| appName | <code>string</code> |  | The target application. |
| relativePath | <code>string</code> |  | The path of the file to read. |
| [encoding] | <code>string</code> \| <code>null</code> | <code>&quot;&#x27;utf8&#x27;&quot;</code> | The encoding to use. Pass null for a raw Buffer. |

**Example**  
```js
const content = platform.readFile('myApp', 'box/api/test.js');console.log(content); // 'console.log("Hello World");'
```
<a name="module_platform.registerNewApp"></a>

### platform.registerNewApp(appName) ⇒ <code>object</code>
Registers a new application in the server's context.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>object</code> - Confirmation message and paths.  
**Throws**:

- <code>Error</code> If the app already exists or if the name is invalid.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to register. |

**Example**  
```js
const result = platform.registerNewApp('myApp');console.log(result); // true if registered successfully
```
<a name="module_platform.reloadApp"></a>

### platform.reloadApp(appName) ⇒ <code>boolean</code>
Reloads an application's configuration and clears its caches.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>boolean</code> - True if the app was reloaded successfully.  
**Throws**:

- <code>Error</code> If the app does not exist.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The app to reload. |

**Example**  
```js
const result = platform.reloadApp('myApp');console.log(result); // true if reloaded successfully
```
<a name="module_platform.deleteApp"></a>

### platform.deleteApp(appName) ⇒ <code>boolean</code>
Recursively deletes an entire application directory. This is a destructive action.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>boolean</code> - True if the app was deleted successfully.  
**Throws**:

- <code>Error</code> If the app does not exist or if the deletion is outside theweb root.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to delete. |

**Example**  
```js
const result = platform.deleteApp('myApp');console.log(result); // true if deleted successfully
```
<a name="module_platform.unzipToApp"></a>

### platform.unzipToApp(appName, relativePath, zipBuffer) ⇒ <code>Promise.&lt;boolean&gt;</code>
Unzips a buffer into a target folder within an app, validating each entry for security.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A promise that resolves to true if the unzip was successful.  
**Throws**:

- <code>Error</code> If the app does not exist or if the zip contains invalid paths.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The target application. |
| relativePath | <code>string</code> | The folder within the app to extract to. |
| zipBuffer | <code>Buffer</code> | The zip data as a buffer. |

**Example**  
```js
const result = await platform.unzipToApp('myApp', 'uploads', zipBuffer);console.log(result); // true if unzipped successfully
```
<a name="module_platform.zipApp"></a>

### platform.zipApp(appName) ⇒ <code>Promise.&lt;Buffer&gt;</code>
Zips an entire application's directory and returns the data as a buffer.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - A promise that resolves with the zip file data.  
**Throws**:

- <code>Error</code> If the app does not exist or if the zipping fails.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to zip. |

**Example**  
```js
const zipBuffer = await platform.zipApp('myApp');console.log(zipBuffer); // The zipped app data
```
<a name="module_platform.packageApp"></a>

### platform.packageApp(appName) ⇒ <code>Promise.&lt;Buffer&gt;</code>
Packages an entire application into a distributable .gin archive buffer.Obeys the rules in the app's .gpkg manifest file if it exists.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - A promise that resolves with the .gin file data.  
**Throws**:

- <code>Error</code> If the app does not exist or if the packaging fails.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to package. |

**Example**  
```js
const packageBuffer = await platform.packageApp('myApp');console.log(packageBuffer); // The packaged app data
```
<a name="module_platform.mockUpgrade"></a>

### platform.mockUpgrade(appName, packageBuffer) ⇒ <code>Promise.&lt;object&gt;</code>
Mocks an upgrade plan for an app based on a package buffer.This is a utility function for verifying an app upgrade deployment before it happens.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with the upgrade plan.  
**Throws**:

- <code>Error</code> If the app does not exist or if the package buffer is invalidor contains security issues.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to upgrade. |
| packageBuffer | <code>Buffer</code> | The .gin file content as a buffer. |

**Example**  
```js
const upgradePlan = await platform.mockUpgrade('myApp', zipBuffer);console.log(upgradePlan); // { action: 'Upgrade', fromVersion: '1.0.0', toVersion: '2.0.0', files: { preserved: [], added: [], overwritten: [], deleted: [] } }
```
<a name="module_platform.listBackups"></a>

### platform.listBackups(appName) ⇒ <code>Array.&lt;string&gt;</code>
Lists all backups for a specific application.Backups are stored in the 'backups' directory under the project root.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Array.&lt;string&gt;</code> - An array of backup file names sorted by date (newest first).  
**Throws**:

- <code>Error</code> If the app does not exist or if the backups directory is inaccessible.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the application to list backups for. |

**Example**  
```js
const backups = platform.listBackups('myApp');console.log(backups);
```
<a name="module_platform.mockRollback"></a>

### platform.mockRollback(appName) ⇒ <code>Promise.&lt;object&gt;</code>
Mocks a rollback plan for an app based on the latest backup.This is a utility function for verifying an app rollback deployment before it happens.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with the rollback plan.  
**Throws**:

- <code>Error</code> If the app does not exist or if there are no backups available.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to rollback. |

**Example**  
```js
const rollbackPlan = await platform.mockRollback('myApp');console.log(rollbackPlan); // { action: 'Rollback', fromVersion: '2.0.0', toVersion: '1.0.0', files: { preserved: [], added: [], overwritten: [], deleted: [] } }
```
<a name="module_platform.installApp"></a>

### platform.installApp(appName, packageBuffer, permissions) ⇒ <code>Promise.&lt;object&gt;</code>
Installs a new application from a .gin package buffer into a new directory.Fails if an app with the same name already exists.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with a success message.  
**Throws**:

- <code>Error</code> If the app already exists or if the installation fails.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to create/install. |
| packageBuffer | <code>Buffer</code> | The .gin file content as a buffer. |
| permissions | <code>object</code> | Permissions to set for the new app. |

**Example**  
```js
const grantedPermissions = ["cache", "db", "fs"];const result = await platform.installApp('myApp', packageBuffer, grantedPermissions);console.log(result); // true if installed successfully
```
<a name="module_platform.upgradeApp"></a>

### platform.upgradeApp(appName, packageBuffer, permissions, [options]) ⇒ <code>Promise.&lt;boolean&gt;</code>
Upgrades an existing application to a new version using a .gin package buffer.Preserves files as specified in the app's .gup configuration.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A promise that resolves to true if the upgrade was successful.  
**Throws**:

- <code>Error</code> If the app does not exist or if the upgrade fails.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| appName | <code>string</code> |  | The name of the app to upgrade. |
| packageBuffer | <code>Buffer</code> |  | The .gin file content as a buffer. |
| permissions | <code>object</code> |  | Permissions to set for the upgraded app. |
| [options] | <code>object</code> | <code>{ backup: true }</code> | Options for the upgrade process. |

**Example**  
```js
const grantedPermissions = ["cache", "db", "fs"];const result = await platform.upgradeApp('myApp', packageBuffer, grantedPermissions);console.log(result); // true if upgraded successfully
```
<a name="module_platform.rollbackApp"></a>

### platform.rollbackApp(appName, grantedPermissions) ⇒ <code>Promise.&lt;boolean&gt;</code>
Rolls back an application to its previous version using the latest backup.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A promise that resolves to true if the rollback was successful.  
**Throws**:

- <code>Error</code> If the app does not exist or if the rollback fails.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the app to rollback. |
| grantedPermissions | <code>Array.&lt;string&gt;</code> | The permissions granted to the app. |

**Example**  
```js
const result = await platform.rollbackApp('myApp');console.log(result); // true if rolled back successfully
```
<a name="module_platform.installFromBackup"></a>

### platform.installFromBackup(appName, [backupVersion]) ⇒ <code>Promise.&lt;object&gt;</code>
Installs an application from a previously created backup file.

**Kind**: static method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with a success message.  
**Throws**:

- <code>Error</code> If the app does not exist, if no backups are found, or if the backup file is missing.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| appName | <code>string</code> |  | The name of the application to install. |
| [backupVersion] | <code>string</code> | <code>&quot;&#x27;latest&#x27;&quot;</code> | The specific backup file to use, or 'latest' for the most recent. |

**Example**  
```js
const result = await platform.installFromBackup('myApp');console.log(result); // true if installed successfully
```
<a name="module_platform..getAppPermissions"></a>

### platform~getAppPermissions(appName) ⇒ <code>Promise.&lt;object&gt;</code>
Retrieves the permissions for a specific application.

**Kind**: inner method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with the app's permissions.  
**Throws**:

- <code>Error</code> If the app is not found.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the application. |

<a name="module_platform..setAppPermissions"></a>

### platform~setAppPermissions(appName, permissionsArray, [reload]) ⇒ <code>Promise.&lt;object&gt;</code>
Sets the permissions for a specific application.

**Kind**: inner method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - A promise that resolves with a success message.  
**Throws**:

- <code>Error</code> If the app is not found.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| appName | <code>string</code> |  | The name of the application. |
| permissionsArray | <code>Array.&lt;string&gt;</code> |  | The permissions to set. |
| [reload] | <code>boolean</code> | <code>true</code> | Whether to reload the app after setting permissions. |

<a name="module_platform..removeAppPermissions"></a>

### platform~removeAppPermissions(appName) ⇒ <code>Promise.&lt;boolean&gt;</code>
Removes all permissions for a specific application.

**Kind**: inner method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;boolean&gt;</code> - A promise that resolves with a success message.  

| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the application. |

<a name="module_platform..analyzeAppBackup"></a>

### platform~analyzeAppBackup(appName) ⇒ <code>Promise.&lt;object&gt;</code>
Analyzes the backup of a specific application.

**Kind**: inner method of [<code>platform</code>](#module_platform)  
**Returns**: <code>Promise.&lt;object&gt;</code> - - A promise that resolves with the analysis results.  
**Throws**:

- <code>Error</code> If the app is not found or the backup is invalid.


| Param | Type | Description |
| --- | --- | --- |
| appName | <code>string</code> | The name of the application. |

<a name="module_qrcode"></a>

## qrcode
Provides functions to generate QR codes and 1D barcodes.


* [qrcode](#module_qrcode)
    * [.BUFFER](#module_qrcode.BUFFER)
    * [.DATA_URL](#module_qrcode.DATA_URL)
    * [.qrcode(text, [options])](#module_qrcode.qrcode) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>
    * [.barcode(format, text, [options])](#module_qrcode.barcode) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>

<a name="module_qrcode.BUFFER"></a>

### qrcode.BUFFER
Constant for Buffer output type.This constant can be used to specify that the output should be a Buffer.

**Kind**: static constant of [<code>qrcode</code>](#module_qrcode)  
<a name="module_qrcode.DATA_URL"></a>

### qrcode.DATA\_URL
Constant for Data URL output type.This constant can be used to specify that the output should be a Data URL.

**Kind**: static constant of [<code>qrcode</code>](#module_qrcode)  
<a name="module_qrcode.qrcode"></a>

### qrcode.qrcode(text, [options]) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>
Generates a QR code from the provided text.This function uses the 'qrcode' library to create QR codes, allowing for various output formats.It supports both Buffer and Data URL outputs, making it flexible for different use cases.

**Kind**: static method of [<code>qrcode</code>](#module_qrcode)  
**Returns**: <code>Promise.&lt;(Buffer\|string)&gt;</code> - A promise that resolves with the QR code data.  
**Throws**:

- <code>Error</code> If the input text is not a string or if the output type is invalid.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| text | <code>string</code> |  | The text or data to encode. |
| [options] | <code>object</code> |  | Optional settings. |
| [options.output] | <code>string</code> | <code>&quot;&#x27;buffer&#x27;&quot;</code> | The output type: 'buffer' or 'dataurl'. |
| [options.errorCorrectionLevel] | <code>string</code> | <code>&quot;&#x27;medium&#x27;&quot;</code> | 'low', 'medium', 'quartile', 'high'. |
| [options.margin] | <code>number</code> | <code>4</code> | The width of the quiet zone border. |
| [options.width] | <code>number</code> | <code>200</code> | The width of the image in pixels. |

**Example**  
```js
const qrCode = await qrcode('Hello, world!', { output: qrcode.DATA_URL });console.log(qrCode); // Outputs a Data URL of the QR code image
```
**Example**  
```js
const qrCodeBuffer = await qrcode('Hello, world!', { output: qrcode.BUFFER });console.log(qrCodeBuffer); // Outputs a Buffer of the QR code image
```
<a name="module_qrcode.barcode"></a>

### qrcode.barcode(format, text, [options]) ⇒ <code>Promise.&lt;(Buffer\|string)&gt;</code>
Generates a 1D barcode from the provided text.This function uses the 'jsbarcode' library to create 1D barcodes.

**Kind**: static method of [<code>qrcode</code>](#module_qrcode)  
**Returns**: <code>Promise.&lt;(Buffer\|string)&gt;</code> - A promise that resolves with the barcode data.  
**Throws**:

- <code>Error</code> If the input text is not a string or if the output type is invalid.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| format | <code>string</code> |  | The barcode format (e.g., 'CODE128', 'EAN13', 'UPC'). |
| text | <code>string</code> |  | The text or data to encode. |
| [options] | <code>object</code> |  | Optional settings. |
| [options.output] | <code>string</code> | <code>&quot;&#x27;buffer&#x27;&quot;</code> | The output type: 'buffer' or 'dataurl'. |
| [options.width] | <code>number</code> | <code>2</code> | The width of a single bar. |
| [options.height] | <code>number</code> | <code>100</code> | The height of the bars. |
| [options.displayValue] | <code>boolean</code> | <code>true</code> | Whether to display the text below the barcode. |

**Example**  
```js
const barcode = await barcode('CODE128', '123456789012', { output: barcode.DATA_URL });console.log(barcode); // Outputs a Data URL of the barcode image
```
**Example**  
```js
const barcodeBuffer = await barcode('CODE128', '123456789012', { output: barcode.BUFFER });console.log(barcodeBuffer); // Outputs a Buffer of the barcode image
```
<a name="module_utils"></a>

## utils
A collection of utility functions for various tasks.This module provides functions for generating random data, validating inputs, manipulating strings, and more.It abstracts common tasks into reusable functions, making it easier to write clean and maintainable code.It is particularly useful for tasks that require randomization, validation, or string manipulation.


* [utils](#module_utils)
    * _static_
        * [.rnd](#module_utils.rnd) : <code>object</code>
            * [.int(max)](#module_utils.rnd.int) ⇒ <code>number</code>
            * [.float(max)](#module_utils.rnd.float) ⇒ <code>number</code>
            * [.intInRange(min, max)](#module_utils.rnd.intInRange) ⇒ <code>number</code>
            * [.floatInRange(min, max)](#module_utils.rnd.floatInRange) ⇒ <code>number</code>
            * [.bool()](#module_utils.rnd.bool) ⇒ <code>boolean</code>
            * [.choice(array)](#module_utils.rnd.choice) ⇒ <code>any</code> \| <code>undefined</code>
            * [.shuffle(array)](#module_utils.rnd.shuffle) ⇒ <code>Array.&lt;any&gt;</code>
            * [.color()](#module_utils.rnd.color) ⇒ <code>string</code>
            * [.string(length)](#module_utils.rnd.string) ⇒ <code>string</code>
        * [.string](#module_utils.string) : <code>object</code>
            * [.capitalize(str)](#module_utils.string.capitalize) ⇒ <code>string</code>
            * [.slugify(str)](#module_utils.string.slugify) ⇒ <code>string</code>
            * [.truncate(str, length, [suffix])](#module_utils.string.truncate) ⇒ <code>string</code>
            * [.stripHtml(htmlString)](#module_utils.string.stripHtml) ⇒ <code>string</code>
        * [.misc](#module_utils.misc) : <code>object</code>
            * [.clamp(number, min, max)](#module_utils.misc.clamp) ⇒ <code>number</code>
            * [.groupBy(array, keyOrFn)](#module_utils.misc.groupBy) ⇒ <code>object</code>
    * _inner_
        * [~validate](#module_utils..validate)

<a name="module_utils.rnd"></a>

### utils.rnd : <code>object</code>
A util lib for generating various types of random data.It provides functions to generate random integers, floats, booleans, colors, and stringsUses Math.random(), so it is NOT cryptographically secure.For security-sensitive randomness, use the 'crypto' module.

**Kind**: static namespace of [<code>utils</code>](#module_utils)  

* [.rnd](#module_utils.rnd) : <code>object</code>
    * [.int(max)](#module_utils.rnd.int) ⇒ <code>number</code>
    * [.float(max)](#module_utils.rnd.float) ⇒ <code>number</code>
    * [.intInRange(min, max)](#module_utils.rnd.intInRange) ⇒ <code>number</code>
    * [.floatInRange(min, max)](#module_utils.rnd.floatInRange) ⇒ <code>number</code>
    * [.bool()](#module_utils.rnd.bool) ⇒ <code>boolean</code>
    * [.choice(array)](#module_utils.rnd.choice) ⇒ <code>any</code> \| <code>undefined</code>
    * [.shuffle(array)](#module_utils.rnd.shuffle) ⇒ <code>Array.&lt;any&gt;</code>
    * [.color()](#module_utils.rnd.color) ⇒ <code>string</code>
    * [.string(length)](#module_utils.rnd.string) ⇒ <code>string</code>

<a name="module_utils.rnd.int"></a>

#### rnd.int(max) ⇒ <code>number</code>
Generates a random integer from 0 up to (but not including) max.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>number</code> - A random integer.  
**Throws**:

- <code>Error</code> If max is not a positive number.


| Param | Type | Description |
| --- | --- | --- |
| max | <code>number</code> | The upper bound (exclusive). |

**Example**  
```js
const randomInt = rnd.int(10); // Returns a random integer between 0 and 9console.log(randomInt); // Outputs a random integer
```
<a name="module_utils.rnd.float"></a>

#### rnd.float(max) ⇒ <code>number</code>
Generates a random float from 0 up to (but not including) max.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>number</code> - A random float.  
**Throws**:

- <code>Error</code> If max is not a positive number.


| Param | Type | Description |
| --- | --- | --- |
| max | <code>number</code> | The upper bound (exclusive). |

**Example**  
```js
const randomFloat = rnd.float(10); // Returns a random float between 0 and 10console.log(randomFloat); // Outputs a random float
```
<a name="module_utils.rnd.intInRange"></a>

#### rnd.intInRange(min, max) ⇒ <code>number</code>
Generates a random integer within a given range (inclusive).

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>number</code> - A random integer.  
**Throws**:

- <code>Error</code> If min is greater than max.


| Param | Type | Description |
| --- | --- | --- |
| min | <code>number</code> | The minimum value of the range. |
| max | <code>number</code> | The maximum value of the range. |

**Example**  
```js
const randomInt = rnd.intInRange(1, 10); // Returns a random integer between 1 and 10console.log(randomInt); // Outputs a random integer
```
<a name="module_utils.rnd.floatInRange"></a>

#### rnd.floatInRange(min, max) ⇒ <code>number</code>
Generates a random float within a given range.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>number</code> - A random float.  
**Throws**:

- <code>Error</code> If min is greater than max.


| Param | Type | Description |
| --- | --- | --- |
| min | <code>number</code> | The minimum value of the range. |
| max | <code>number</code> | The maximum value of the range. |

**Example**  
```js
const randomFloat = rnd.floatInRange(1.5, 5.5); // Returns a random float between 1.5 and 5.5console.log(randomFloat); // Outputs a random float
```
<a name="module_utils.rnd.bool"></a>

#### rnd.bool() ⇒ <code>boolean</code>
Returns a random boolean (true or false).

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Example**  
```js
const randomBool = rnd.bool(); // Returns either true or falseconsole.log(randomBool); // Outputs a random boolean
```
<a name="module_utils.rnd.choice"></a>

#### rnd.choice(array) ⇒ <code>any</code> \| <code>undefined</code>
Selects a random element from an array.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>any</code> \| <code>undefined</code> - A random element from the array, or undefined if the array is empty.  

| Param | Type | Description |
| --- | --- | --- |
| array | <code>Array.&lt;any&gt;</code> | The array to choose from. |

**Example**  
```js
const randomChoice = rnd.choice([1, 2, 3, 4, 5]); // Returns a random element from the arrayconsole.log(randomChoice); // Outputs a random element from the array
```
**Example**  
```js
const randomChoice = rnd.choice([]); // Returns undefined
```
<a name="module_utils.rnd.shuffle"></a>

#### rnd.shuffle(array) ⇒ <code>Array.&lt;any&gt;</code>
Shuffles an array in place using the Fisher-Yates algorithm and returns it.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>Array.&lt;any&gt;</code> - The shuffled array.  

| Param | Type | Description |
| --- | --- | --- |
| array | <code>Array.&lt;any&gt;</code> | The array to shuffle. |

**Example**  
```js
const shuffledArray = rnd.shuffle([1, 2, 3, 4, 5]); // Returns a shuffled version of the arrayconsole.log(shuffledArray); // Outputs the shuffled array
```
<a name="module_utils.rnd.color"></a>

#### rnd.color() ⇒ <code>string</code>
Generates a random hex color code.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>string</code> - A random hex color string (e.g., '#a4c1e8').  
**Example**  
```js
const randomColor = rnd.color(); // Returns a random hex color codeconsole.log(randomColor); // Outputs a random hex color code
```
<a name="module_utils.rnd.string"></a>

#### rnd.string(length) ⇒ <code>string</code>
Generates a random string of a given length using only alphabetic characters.NOT cryptographically secure. For secure random strings, use the 'crypto' module.

**Kind**: static method of [<code>rnd</code>](#module_utils.rnd)  
**Returns**: <code>string</code> - A random string of letters.  

| Param | Type | Description |
| --- | --- | --- |
| length | <code>number</code> | The desired length of the string. |

**Example**  
```js
const randomString = rnd.string(10); // Returns a random string of 10 charactersconsole.log(randomString); // Outputs a random string of letters
```
<a name="module_utils.string"></a>

### utils.string : <code>object</code>
A collection of string manipulation utilities.Provides functions for string formatting, slugification, truncation, and HTML stripping.These functions are useful for preparing strings for display, storage, or further processing.They help ensure strings are in a consistent format, making them easier to work with in applications

**Kind**: static namespace of [<code>utils</code>](#module_utils)  

* [.string](#module_utils.string) : <code>object</code>
    * [.capitalize(str)](#module_utils.string.capitalize) ⇒ <code>string</code>
    * [.slugify(str)](#module_utils.string.slugify) ⇒ <code>string</code>
    * [.truncate(str, length, [suffix])](#module_utils.string.truncate) ⇒ <code>string</code>
    * [.stripHtml(htmlString)](#module_utils.string.stripHtml) ⇒ <code>string</code>

<a name="module_utils.string.capitalize"></a>

#### string.capitalize(str) ⇒ <code>string</code>
Converts the first character of a string to uppercase.

**Kind**: static method of [<code>string</code>](#module_utils.string)  
**Returns**: <code>string</code> - or empty string if input is not a string.  

| Param | Type | Description |
| --- | --- | --- |
| str | <code>string</code> | The input string. |

**Example**  
```js
const capitalized = string.capitalize('hello world');console.log(capitalized); // Outputs: Hello world
```
<a name="module_utils.string.slugify"></a>

#### string.slugify(str) ⇒ <code>string</code>
Converts a string into a URL-friendly "slug".

**Kind**: static method of [<code>string</code>](#module_utils.string)  
**Returns**: <code>string</code> - or empty string if input is not a string.  

| Param | Type | Description |
| --- | --- | --- |
| str | <code>string</code> | The input string. |

**Example**  
```js
const slug = string.slugify('Hello World! This is a test.');console.log(slug); // Outputs: hello-world-this-is-a-test
```
<a name="module_utils.string.truncate"></a>

#### string.truncate(str, length, [suffix]) ⇒ <code>string</code>
Truncates a string to a maximum length without cutting words in half.

**Kind**: static method of [<code>string</code>](#module_utils.string)  
**Returns**: <code>string</code> - or empty string if input is not a string.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| str | <code>string</code> |  | The input string. |
| length | <code>number</code> |  | The maximum length. |
| [suffix] | <code>string</code> | <code>&quot;&#x27;...&#x27;&quot;</code> | The suffix to append if truncated. |

**Example**  
```js
const truncated = string.truncate('This is a long string that needs to be truncated.', 30);console.log(truncated); // Outputs: This is a long string that...
```
<a name="module_utils.string.stripHtml"></a>

#### string.stripHtml(htmlString) ⇒ <code>string</code>
Removes all HTML tags from a string.

**Kind**: static method of [<code>string</code>](#module_utils.string)  
**Returns**: <code>string</code> - or empty string if input is not a string.  

| Param | Type | Description |
| --- | --- | --- |
| htmlString | <code>string</code> | The input string containing HTML. |

**Example**  
```js
const cleanString = string.stripHtml('<p>This is <strong>bold</strong> text.</p>');console.log(cleanString); // Outputs: This is bold text.
```
<a name="module_utils.misc"></a>

### utils.misc : <code>object</code>
A collection of miscellaneous utility functions.Provides functions for clamping numbers, grouping arrays, and other common tasks.These functions help with data manipulation and organization, making it easier to work with collections of data.

**Kind**: static namespace of [<code>utils</code>](#module_utils)  

* [.misc](#module_utils.misc) : <code>object</code>
    * [.clamp(number, min, max)](#module_utils.misc.clamp) ⇒ <code>number</code>
    * [.groupBy(array, keyOrFn)](#module_utils.misc.groupBy) ⇒ <code>object</code>

<a name="module_utils.misc.clamp"></a>

#### misc.clamp(number, min, max) ⇒ <code>number</code>
Restricts a number to be within a specific range.

**Kind**: static method of [<code>misc</code>](#module_utils.misc)  

| Param | Type | Description |
| --- | --- | --- |
| number | <code>number</code> | The number to clamp. |
| min | <code>number</code> | The minimum boundary. |
| max | <code>number</code> | The maximum boundary. |

**Example**  
```js
const clampedValue = misc.clamp(15, 10, 20);console.log(clampedValue); // Outputs: 15
```
**Example**  
```js
const clampedValue = misc.clamp(25, 10, 20);console.log(clampedValue); // Outputs: 20
```
<a name="module_utils.misc.groupBy"></a>

#### misc.groupBy(array, keyOrFn) ⇒ <code>object</code>
Groups the elements of an array into an object based on a key or function.

**Kind**: static method of [<code>misc</code>](#module_utils.misc)  

| Param | Type | Description |
| --- | --- | --- |
| array | <code>Array.&lt;object&gt;</code> | The array to group. |
| keyOrFn | <code>string</code> \| <code>function</code> | The key string or a function to determine the group. |

**Example**  
```js
const grouped = misc.groupBy([{ id: 1, category: 'A' }, { id: 2, category: 'B' }, { id: 3, category: 'A' }], 'category');console.log(grouped);// Outputs: { A: [{ id: 1, category: 'A' }, { id: 3, category: 'A' }], B: [{ id: 2, category: 'B' }] }
```
**Example**  
```js
const grouped = misc.groupBy([{ id: 1, value: 10 }, { id: 2, value: 20 }, { id: 3, value: 10 }], item => item.value);console.log(grouped);// Outputs: { 10: [{ id: 1, value: 10 }, { id: 3, value: 10 }], 20: [{ id: 2, value: 20 }] }
```
<a name="module_utils..validate"></a>

### utils~validate
A collection of validation utilities for common data types.Provides functions to check if a string is a valid email, URL, phone number, and more.These functions help ensure that data conforms to expected formats, making it easier to validate user input.

**Kind**: inner property of [<code>utils</code>](#module_utils)  
<a name="module_uuid"></a>

## uuid
Provides functions to generate and validate UUIDs (Universally Unique Identifiers).


* [uuid](#module_uuid)
    * [.v4()](#module_uuid.v4) ⇒ <code>string</code>
    * [.validate(uuidString)](#module_uuid.validate) ⇒ <code>boolean</code>

<a name="module_uuid.v4"></a>

### uuid.v4() ⇒ <code>string</code>
Generates a random RFC 4122 Version 4 UUID.Uses the built-in, cryptographically secure random UUID generator.

**Kind**: static method of [<code>uuid</code>](#module_uuid)  
**Returns**: <code>string</code> - A new UUID string (e.g., "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d").  
**Example**  
```js
const uuid = require('uuid');const newUuid = uuid.v4();console.log(newUuid); // Outputs a random UUID
```
<a name="module_uuid.validate"></a>

### uuid.validate(uuidString) ⇒ <code>boolean</code>
Validates if a string is a correctly formatted UUID.This function checks if the string matches the standard UUID format (8-4-4-4-12 hex digits).It does not check if the UUID is actually in use or registered, only its format.

**Kind**: static method of [<code>uuid</code>](#module_uuid)  
**Returns**: <code>boolean</code> - True if the string is a valid UUID, false otherwise.  

| Param | Type | Description |
| --- | --- | --- |
| uuidString | <code>string</code> | The string to validate. |

**Example**  
```js
const uuid = require('uuid');const isValid = uuid.validate('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');console.log(isValid); // Outputs true or false
```
<a name="module_zip"></a>

## zip
Provides functions to zip and unzip files and directories securely.This module allows you to create zip archives from files or directories, and extract zip files to specified locations.It ensures that all file operations are performed within the secure boundaries defined by the Gingee framework.<b>NOTE:</b> path with leading slash indicates path from scope root, path without leading slash indicates path relative to the executing script<b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.


* [zip](#module_zip)
    * [.zip(scope, sourcePath, [options])](#module_zip.zip) ⇒ <code>Promise.&lt;Buffer&gt;</code>
    * [.zipToFile(sourceScope, sourcePath, destScope, destPath, [options])](#module_zip.zipToFile) ⇒ <code>Promise.&lt;void&gt;</code>
    * [.unzip(sourceScope, sourcePath, destScope, destPath)](#module_zip.unzip) ⇒ <code>Promise.&lt;void&gt;</code>

<a name="module_zip.zip"></a>

### zip.zip(scope, sourcePath, [options]) ⇒ <code>Promise.&lt;Buffer&gt;</code>
Zips a file or directory into an in-memory buffer.This function allows you to create a zip archive from a single file or an entire directory.

**Kind**: static method of [<code>zip</code>](#module_zip)  
**Returns**: <code>Promise.&lt;Buffer&gt;</code> - A promise that resolves with the zip file data as a Buffer.  
**Throws**:

- <code>Error</code> If the source file or directory does not exist, or if the path traversal is detected.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| scope | <code>string</code> |  | The scope of the source (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> |  | The path to the file or directory to zip. |
| [options] | <code>object</code> |  | Optional settings. |
| [options.includeRootFolder] | <code>boolean</code> | <code>false</code> | If true and source is a directory, the directory itself is included at the root of the zip. |

**Example**  
```js
const zip = require('zip');const zipBuffer = await zip.zip(fs.BOX, '/path/to/source');console.log(zipBuffer); // Outputs a Buffer containing the zip file data
```
<a name="module_zip.zipToFile"></a>

### zip.zipToFile(sourceScope, sourcePath, destScope, destPath, [options]) ⇒ <code>Promise.&lt;void&gt;</code>
Zips a file or directory to a destination zip file.

**Kind**: static method of [<code>zip</code>](#module_zip)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A promise that resolves when the zip file is created.  
**Throws**:

- <code>Error</code> If the source file or directory does not exist, or if the path traversal is detected, or if zipping between scopes is attempted without the allowCrossOrigin option.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| sourceScope | <code>string</code> |  | The scope of the source (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> |  | The path to the file or directory to zip. |
| destScope | <code>string</code> |  | The scope of the destination (fs.BOX or fs.WEB). |
| destPath | <code>string</code> |  | The path to the destination zip file. |
| [options] | <code>object</code> |  | Optional settings. |
| [options.includeRootFolder] | <code>boolean</code> | <code>false</code> | If true and source is a directory, the directory itself is included at the root of the zip. |

**Example**  
```js
const fs = require('fs'); // Gingee secure fs moduleconst zip = require('zip');await zip.zipToFile(fs.BOX, '/path/to/source', fs.BOX, '/path/to/destination.zip');if(fs.existsSync(fs.BOX, '/path/to/destination.zip')) {    console.log("Zip file created successfully.");}
```
<a name="module_zip.unzip"></a>

### zip.unzip(sourceScope, sourcePath, destScope, destPath) ⇒ <code>Promise.&lt;void&gt;</code>
Unzips a source zip file to a destination folder.

**Kind**: static method of [<code>zip</code>](#module_zip)  
**Returns**: <code>Promise.&lt;void&gt;</code> - A promise that resolves when the unzip operation is complete.  
**Throws**:

- <code>Error</code> If the source zip file does not exist, or if the path traversal is detected, or if unzipping between scopes is attempted without the allowCrossOrigin option.


| Param | Type | Description |
| --- | --- | --- |
| sourceScope | <code>string</code> | The scope of the source (fs.BOX or fs.WEB). |
| sourcePath | <code>string</code> | The path to the source zip file. |
| destScope | <code>string</code> | The scope of the destination (fs.BOX or fs.WEB). |
| destPath | <code>string</code> | The path to the destination folder. |

**Example**  
```js
const fs = require('fs'); // Gingee secure fs moduleconst zip = require('zip');await zip.unzip(fs.BOX, '/path/to/source.zip', fs.BOX, '/path/to/destination');if(fs.existsSync(fs.BOX, '/path/to/destination')) {    console.log("Unzip operation completed successfully.");}
```


## Important points to remember
- Gingee is sandboxed and does not allow usage of any NodeJS builtin modules or other external libraries.
- Some Gingee modules such as 'fs' sound similar to the NodeJS builtin modules but are not the same. Always refer the API reference to use these modules.
- Always follow the security and permission guidelines outlined in the documentation.
- File paths with leading slashes are relative to the scope root (BOX or WEB) as applicable.
- File paths without leading slashes are relative to the working directory of the executing script.
- Server script URLs do not end with '.js' or any other extension, when you are trying to access them e.g. via the Browser 'fetch' function