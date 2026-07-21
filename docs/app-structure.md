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
  "mode": "production",
  "spa": {
    "enabled": false,
    "dev_server_proxy": "http://localhost:5173",
    "build_path": "./dist",
    "fallback_path": "index.html"
  },
  "db": [],
  "email": {
    "type": "console",
    "from": "noreply@example.com",
    "from_name": "My App"
  },
  "ai": {
    "type": "mock",
    "default_model": "mock-model"
  },
  "schedules": [],
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

### Application Type & Mode

- **`type`** (string, optional)
  - **`"MPA"`** (Multi-Page Application): The default. Serves classic multi-page sites and file-based or manifest-based server scripts under `box/`.
  - **`"SPA"`** (Single Page Application): Enables first-class SPA hosting for frameworks such as React, Vue, and Angular. Combined with `spa.enabled`, Gingee:
    - In **`development`** mode, proxies non-API requests to your frontend hot-reload server (`spa.dev_server_proxy`).
    - In **`production`** mode, serves compiled assets from `spa.build_path` and falls back to `spa.fallback_path` (typically `index.html`) for client-side routes.
    - Continues to execute backend scripts under `box/` (file-based or `routes.json`) for API endpoints.
    - See the [SPA Developer's Guide](./app-spadev-guide.md) for a full walkthrough.

- **`mode`** (string, optional)
  - **`"production"`** (Default): The standard mode for live servers. For SPAs, this serves the compiled static assets from the `build_path` and applies SPA fallback routing.
  - **`"development"`** : Activates development-only features. For SPAs, this enables the seamless dev server proxy.

### SPA Configuration (`spa` object)
This object is used when the app is of `"type": "SPA"`. SPA behavior is active when both `"type": "SPA"` and `"spa.enabled": true` are set.

- **`spa.enabled`** (boolean, required for SPA mode): Must be `true` to activate SPA features (dev proxy and production fallback).
- **`spa.dev_server_proxy`** (string, optional): **(Development only)** The full URL of your frontend's hot-reloading development server (e.g., Vite, Angular CLI). Gingee will proxy all non-API requests to this URL when the app's `mode` is `"development"`. Required in development; missing configuration yields a `500` with a clear misconfiguration message.
- **`spa.build_path`** (string, optional): **(Production)** The path to the directory containing your compiled frontend assets, relative to the app's root folder. Defaults to `./dist` if omitted.
- **`spa.fallback_path`** (string, optional): **(Production)** The path to the SPA's entrypoint file within the `build_path`. Defaults to `index.html`. Gingee serves this file for any request that doesn't match an API route or a static asset, enabling client-side routing.

### Database Connections

- **`db`** (array, optional)
  - An array of database connection objects.
  - **Properties:** `type`, `name`, `host`, `user`, `password`, `database`, etc.

### AI (`ai` object, optional)

Single generative AI configuration for the app. App config overrides optional server defaults in `gingee.json` → `ai`. Requires the `ai` permission.

- **`type`** (string): Provider — `mock` (local/dev), `gemini` (Google), `xai` (Grok — P1).
- **`api_key`** (string): Provider API key (not required for `mock`).
- **`default_model`** / **`default_vision_model`** (string, optional)
- **`max_output_tokens`**, **`timeout_ms`**, **`temperature`** (optional)
- **`safety`** (object, optional): `{ "enabled": false, "fail_closed": true, "moderate_input": false }`

**API (sandbox):** `require('ai')` → `chat`, `chatStream` (async generator), `complete`, `parseDocument`, `moderate`. Pass `{ config: { … } }` as the second argument to override server/app config for one call.

**Example:**
```json
"ai": {
  "type": "gemini",
  "api_key": "AIza…",
  "default_model": "gemini-2.5-pro"
}
```

### Secrets in `app.json`

Any string value may be a **secret reference** resolved by the engine at app load (not by sandbox `process.env`):

```json
"jwt_secret": "env:GINGEE_MYAPP_JWT_SECRET",
"db": [{
  "type": "postgres",
  "name": "main",
  "host": "db.internal",
  "user": "myapp",
  "password": "env:GINGEE_MYAPP_DB_PASSWORD",
  "database": "myapp"
}],
"email": {
  "type": "sendgrid",
  "api_key": "env:GINGEE_MYAPP_SENDGRID_KEY",
  "from": "noreply@example.com"
},
"ai": {
  "type": "gemini",
  "api_key": "file:./settings/secrets/myapp_gemini_key"
}
```

- **`env:NAME`** — read from the host process environment (set by Docker/K8s/systemd or optional `.env` when `secrets.load_dotenv` is true).
- **`file:path`** — read a secret file under server `secrets.file_roots` only (e.g. Docker/K8s mounted secrets).
- Literals remain valid for local development.

App scripts never need host `process` access; resolved values appear on `$g.app` / module config as normal strings. Server settings: [Server Config](./server-config.md) → `secrets`.

### Limits (`limits` object, optional)

Optional **tightening** of server `gingee.json` → `limits` for this app only (cannot raise ceilings).

```json
"limits": {
  "request_timeout_ms": 15000,
  "max_concurrent_requests": 10,
  "outbound_timeout_ms": 8000
}
```

See [Server Config](./server-config.md) for full field list and defaults. Use this to protect a noisy app from monopolizing the process (lower concurrency) or to fail faster than the server default.

### Isolation (`isolation` string, optional)

Opt-in **process isolation** for this app’s **server scripts** (not static files). Only takes effect when the server has `gingee.json` → `isolation.mode: "process"`. Privileged apps (e.g. Glade) always stay in-process regardless of this flag.

| Value | Meaning |
| :--- | :--- |
| `"process"` | Run box scripts in a child worker (IPC); public HTTP still hits the master |
| `"inprocess"` | Force in-process (default when server mode is process but app is unmarked) |

```json
"isolation": "process"
```

Alternatively list app names under server `isolation.apps`. **v1:** buffered responses only—do not isolate apps that rely on SSE/`startStream` until stream IPC ships. Full server keys: [Server Config](./server-config.md) → `isolation`.

### Schedules (`schedules` array, optional)

Declarative CRON jobs for this app. Registered only when **`gingee.json` → `scheduler.enabled` is `true`** on this node (default `false`). The app must be granted the **`scheduler`** permission. URL targets also require **`httpclient`**.

Each entry:

| Field | Required | Description |
| :--- | :--- | :--- |
| `name` | yes | Unique job id within the app (`a-zA-Z0-9._-`) |
| `cron` | yes | CRON expression (standard 5-field; seconds supported by engine dialect) |
| `timezone` | no | IANA timezone (defaults to server `scheduler.timezone`, usually `UTC`) |
| `enabled` | no | Default `true`. Set `false` to keep the definition without registering |
| `timeout_ms` | no | Default `300000` (script) / `60000` (url) |
| `overlap` | no | Only `"skip"` in v1 (skip if previous run still active) |
| `payload` | no | Passed as `$g.request.body` for **script** targets |
| `target` | yes | See below |

**`target` for scripts** (path is relative to the app’s `box/` folder only):

```json
"target": { "type": "script", "path": "jobs/nightly_cleanup.js" }
```

Scheduled scripts run in the same sandbox as HTTP/startup scripts. Use the usual `gingee(async ($g) => { … })` form. There is no HTTP connection: `$g.request.method` is `"SCHEDULE"`, `$g.schedule` holds `{ name, cron, timezone, runId, scheduledAt, … }`, and `$g.response.send(...)` records a result in logs (it does not open a network response). Streaming is not supported in schedule context.

**`fs` paths in scheduled scripts:** Same rules as all Gingee scripts. A path **with a leading `/`** is relative to the scope root (`box/` or `web/`). A path **without** a leading slash is relative to the **executing script’s directory**. Example: from `box/jobs/cleanup.js`, `fs.writeFile(fs.BOX, 'data/out.json', …)` writes `box/jobs/data/out.json`, while `fs.writeFile(fs.BOX, '/data/out.json', …)` writes `box/data/out.json`. Prefer leading-`/` paths when another HTTP script (with a different working directory) must read the same file.

**`target` for external URLs:**

```json
"target": {
  "type": "url",
  "url": "https://partner.example.com/hooks/tick",
  "method": "POST",
  "headers": { "Authorization": "Bearer …" },
  "body": { "source": "gingee" }
}
```

`url` must be absolute `http:` or `https:`. The engine performs the outbound call (app needs `httpclient`). URLs are checked against server **egress** policy at registration and again when the job fires (default `protected` mode blocks private/loopback/metadata). See [Server Config](./server-config.md) → `egress`.

**Example:**

```json
"schedules": [
  {
    "name": "nightly_cleanup",
    "cron": "0 2 * * *",
    "timezone": "UTC",
    "payload": { "mode": "full" },
    "target": { "type": "script", "path": "jobs/cleanup.js" }
  },
  {
    "name": "partner_ping",
    "cron": "*/15 * * * *",
    "target": {
      "type": "url",
      "url": "https://partner.example.com/hooks/gingee",
      "method": "POST"
    }
  }
]
```

### Email (`email` object, optional)

Single outbound email configuration for the app (no named profiles). App config overrides optional server defaults in `gingee.json` → `email`. Requires the `email` permission.

- **`type`** (string, required when using email): Provider id — `sendgrid` or `console` (dev: logs only, no network).
- **`api_key`** (string): SendGrid API key when `type` is `sendgrid`.
- **`from`** (string): Default From address.
- **`from_name`** (string, optional): Default From display name.

**Runtime override:** from a server script you can call `email.sendWithConfig(config, message)` so a one-off send uses config that overrides both `gingee.json` and `app.json` for that transaction only (does not change the app default).

**Example `app.json`:**
```json
"email": {
  "type": "sendgrid",
  "api_key": "SG.xxxxx",
  "from": "noreply@example.com",
  "from_name": "My App"
}
```

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
