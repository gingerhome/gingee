# Gingee Feature Overview

Gingee is a comprehensive application server designed to accelerate development by providing a rich set of secure, powerful, and easy-to-use features out of the box. This document provides an overview of the key platform features and the standard library of App Modules.

## Key Platform Features

These are the core architectural features that define the Gingee development experience.

*   **Secure Sandbox Execution**
    Every server script runs in a secure, isolated environment. This prevents common vulnerabilities like path traversal and protects the main server process from errors or crashes in application code.

*   **Whitelist-Based Permissions System**
    A secure-by-default model where applications must be explicitly granted privileges by an administrator to access sensitive modules like the filesystem (`fs`), database (`db`), outbound HTTP client (`httpclient`), transactional email (`email`), or generative AI (`ai`).

*   **Flexible Routing Engine**
    Gingee features a powerful routing engine with two modes. For regular apps, use the zero-config **File-Based Routing**. For building RESTful APIs, create a `routes.json` manifest to enable **Manifest-Based Routing** with dynamic path parameters (e.g., `/users/:id`).

*   **Multi-Database Abstraction Layer**
    Write your database logic once and deploy against multiple database systems. Gingee supports PostgreSQL, MySQL/MariaDB, SQLite, MS SQL Server, and Oracle, automatically transpiling queries for the target database.

*   **Modern JavaScript Support (ESM)**
    Use modern ES Module syntax (`import`/`from`) directly in your backend scripts. Gingee uses on-the-fly transpilation to handle this automatically, with no build steps or complex `package.json` configuration required.

*   **SPA Hosting & Development Workflow**
    Gingee provides first-class support for modern Single Page Applications (React, Vue, Angular). In development (`type: "SPA"`, `mode: "development"`), it proxies non-API requests to your frontend's native hot-reloading server for a unified, CORS-free environment. In production, it serves compiled assets from `spa.build_path` and falls back to `spa.fallback_path` (e.g. `index.html`) for client-side routers. Backend APIs continue to run from the secure `box/` folder. See the [SPA Developer's Guide](./app-spadev-guide.md).

*   **Application Lifecycle Management**
    A privileged `platform` module allows for full lifecycle management, enabling the creation, packaging (`.gin`), installation, upgrading, backup, and rollback of applications, a powerful module accessible to designated `privileged apps` as configured in `gingee.json`. The default Gingee Glade Admin Tool is one such privileged app.

*   **App Store with Interactive Installation**
    The `gingee-cli` provides commands to browse and install applications from any decentralized "GStore" - the Gingee app store (a static server hosting a `gstore.json` manifest). The installation process is fully interactive, reading a permissions manifest (`pmft.json`) and database requirements directly from the app package to guide the administrator through a secure, one-command setup.

*   **Hierarchical & Context-Aware Logging**
    Each app writes to its own structured JSON log file within its private `box` directory, while logs are also forwarded to a central, timestamped server log for a complete system overview.

*   **Resilient Distributed Caching**
    The server provides a centralized, pluggable caching service. Use a dependency-free in-memory cache for local development, or switch to a Redis backend for horizontally scaled production deployments by changing a single line of config.

*   **Transactional Email (`email` Module)**
    Send mail through a provider adapter (SendGrid in v1, plus a `console` logger for local dev). Config is a single object in `app.json` (optional defaults in `gingee.json`). Apps call `email.send(message)` or `email.sendWithConfig(runtimeConfig, message)` for a one-transaction override. Requires the `email` permission.

*   **Generative AI (`ai` Module)**
    Chat, streaming completions (`chatStream`), multimodal image/file parts, document parsing/OCR, and content moderation behind a provider adapter (`mock`, `gemini`; `xai` planned). Single hybrid config (`gingee.json` / `app.json`) with optional per-call `{ config }` override. Streaming apps use `$g.response.startStream` / `writeSSE` / `endStream`. Requires the `ai` permission.

*   **Streamed HTTP Responses**
    Server scripts can stream progressive output (for example Server-Sent Events for AI tokens) via `$g.response.startStream()`, `write()` / `writeSSE()`, and `endStream()`, without exposing Node’s raw response object to the sandbox.

*   **CRON Scheduler**
    Apps declare recurring jobs in `app.json` → `schedules` (script path under `box/` or absolute external URL). The in-process scheduler is **off by default** (`gingee.json` → `scheduler.enabled`); enable it on **one** node in multi-server deployments. Requires the `scheduler` permission (and `httpclient` for URL targets). Overlap policy is skip; jobs are skipped while the app is in maintenance.

*   **Request & Outbound Limits**
    Process-wide and per-app **concurrency caps**, **request wall-clock timeouts**, **stream idle/hard timeouts**, and default **`httpclient` outbound timeouts** (`gingee.json` → `limits`). Overload returns **503**; request budget expiry returns **504**. Apps may only tighten limits in `app.json`.

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
*   **`email`**
    Transactional email via provider adapters (`sendgrid`, `console`). Config from `gingee.json` / `app.json`, plus `sendWithConfig` for per-transaction overrides. Permission-protected.
*   **`ai`**
    Generative AI (chat, streaming `chatStream`, multimodal parts, document parse/OCR, content moderation). Providers: `mock`, `gemini` (v1); `xai` (Grok) planned P1. Permission-protected; per-call config override supported.
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
