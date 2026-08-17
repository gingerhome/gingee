# Gingee Permissions Guide

Security is a core principle of the Gingee platform. The permissions system is designed to be **secure by default**, following the **Principle of Least Privilege**. This guide explains how permissions are declared by developers and managed by administrators to create a safe and predictable server environment.

**Important:** Permissions and the app sandbox provide **cooperative multi-app isolation** on a shared Node.js process. They are **not** a hard boundary against mutually hostile tenants. Before deploying untrusted apps, read the **[Gingee Threat Model](./threat-model.md)**.

## The Philosophy: Secure by Default (Whitelist Model)

Gingee operates on a strict **whitelist model**. By default, a sandboxed application has **no access** to potentially sensitive modules like the filesystem (`fs`), database (`db`), outbound HTTP client (`httpclient`), transactional email (`email`), generative AI (`ai`), or the CRON **scheduler**.

Access to these protected modules must be explicitly **granted** by a server administrator. If a permission has not been granted, any attempt by an app to `require()` that module will result in a security error, and the script will fail to execute.

This model ensures that administrators have full control and awareness of an application's capabilities.

## For App Developers: Declaring Permissions (`pmft.json`)

When you build an application that you intend to distribute (as a `.gin` file) or share, you must declare the permissions it requires in a manifest file. This file acts as a formal request to the administrator who will install your app.

- **File Name:** `pmft.json` (Permissions Manifest)
- **Location:** `web/<your-app-name>/box/pmft.json`

The `gingee-cli` will read this file directly from your `.gin` package during installation to prompt the administrator for consent.

### Structure of `pmft.json`

The file contains a single `permissions` object with two keys: `mandatory` and `optional`.

- **`mandatory`**: An array of permission keys that are **essential** for your app's core functionality. If the administrator denies a mandatory permission, the installation process should be aborted.
- **`optional`**: An array of permission keys for features that are enhancements but not critical. Your application code should be written to handle cases where an optional permission is not granted.

**Example `pmft.json` for a blog application:**

```json
{
  "permissions": {
    "mandatory": ["db", "fs"],
    "optional": [
      "httpclient",
      "email",
      "ai",
      "scheduler",
      "websockets",
      "queue"
    ]
  }
}
```

_In this example, the blog requires database and filesystem access to function. Optional features (outbound HTTP, transactional email, generative AI) are listed separately so an administrator can grant only what they approve. This file is the definitive source of truth that the `gingee-cli` will use to generate the interactive consent prompts for the administrator during installation._

## For Administrators: Managing Permissions

As a server administrator, you have the final authority on what an application is allowed to do. Permissions are managed in a central, server-wide file and can be easily edited via the Glade admin panel.

### The Central Permissions File (`settings/permissions.json`)

This file is the single source of truth for all application grants on your Gingee server.

- **Location:** `project_root/settings/permissions.json`
- **Structure:** A JSON object where each key is an application's name. The value is an object containing a `granted` array.

**Example `settings/permissions.json`:**

```json
{
  "glade": {
    "granted": ["platform", "fs"]
  },
  "my-blog-app": {
    "granted": ["db", "fs"]
  }
}
```

_In this example, `my-blog-app` was granted its two mandatory permissions, but the administrator chose not to grant the optional `httpclient` permission._

### Managing Permissions in Glade

The easiest way to manage permissions is through the Glade admin panel. On the main dashboard, each application has a **Permissions** button. Clicking this button will open a modal window where you can safely grant or revoke permissions from the master list.

Saving your changes in this modal will automatically update the `settings/permissions.json` file and trigger a safe reload of the application to immediately apply the new security rules.

## Master Permission List

This is the definitive list of all permission keys available in Gingee.

| Permission Key | Description                                                                                                                                                                                                                                                                                     | Security Implication                                                                                                                                            |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **platform**   | **PRIVILEGED.** Allows the app to use the `platform` module to manage the lifecycle (install, delete, upgrade, etc.) of other applications on the server.                                                                                                                                       | **Critical.** This is the highest level of privilege. Only grant this to a fully trusted administration application like `glade`.                               |
| **cache**      | Allows the app to use the caching service for storing and retrieving data.                                                                                                                                                                                                                      | **High.** Grants access to the centralized cache service. Cache access is isolated for app specific data.                                                       |
| **db**         | Allows the app to connect to and query the database(s) configured for it in `app.json`.                                                                                                                                                                                                         | **High.** Grants access to the application's primary data store.                                                                                                |
| **email**      | Allows the app to send transactional email via `require('email')` (configured provider such as SendGrid, or the `console` logger). Supports per-call config override with `email.sendWithConfig`.                                                                                               | **High.** The app can send outbound email using server- or app-configured credentials (or a runtime key). Can incur cost and deliver messages externally.       |
| **ai**         | Allows the app to use generative AI via `require('ai')` (chat, streaming, multimodal, document parsing, content moderation). Providers include `mock` and `gemini` (`xai` planned).                                                                                                             | **High.** The app can send prompts, files, and images to external AI providers (unless using `mock`), with token/cost and data-egress implications.             |
| **websockets** | Allows the app to accept WebSocket connections (`app.json` → `websockets`) and use `require('websockets')` for rooms/broadcast. Multi-node room delivery needs operator `websockets.fanout.driver: "redis"`.                                                                                    | **High.** Long-lived connections share the master event loop; apps can push to all of their connected clients. Grant only when needed.                          |
| **queue**      | Allows the app to enqueue background jobs via `require('queue')` and execute handlers under `box/jobs/`.                                                                                                                                                                                        | **High.** Deferred privileged work (email, AI, heavy processing) with retries; with Redis, work can run on any node. Operators manage live jobs + DLQ in Glade. |
| **scheduler**  | Allows the app to register CRON jobs declared in `app.json` → `schedules` (script under `box/`, outbound URL, or **queue** job name). Jobs only fire when this node has `scheduler.enabled: true` in `gingee.json` (optional multi-node Redis coordination; Glade **Run now** can force a run). | **High.** The app can wake itself on a timer to run privileged sandbox code, enqueue queue jobs, or (with `httpclient`) call external URLs unattended.          |
| **httpclient** | Permits the app to make outbound HTTP/HTTPS requests via `require('httpclient')`. Also required for scheduler **URL** targets. Subject to server **egress** policy (default blocks private/loopback/metadata SSRF targets).                                                                     | **High.** The app can call allowed network destinations; without egress policy this would include internal hosts.                                               |
| **fs**         | Grants full read/write access to files and folders within the app's own secure directories (`box` and `web`).                                                                                                                                                                                   | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files.                                                       |
| **module_override** | Allows `$g.overrideModule(name, boxRelativePath)` so that, for the rest of the request, `require(name)` of a **still-granted** protected module can load an app box script instead of the platform module. Typical use: middleware rebinds `fs` to an app wrapper. See **Module overrides** below. | **High.** Changes the meaning of platform `require()` for that request. Grant only to trusted apps with reviewed wrappers. Does not open host modules or skip the target module’s own permission. |
| **pdf**        | Allows the app to generate and manipulate PDF documents.                                                                                                                                                                                                                                        | **Medium.** Potential CPU intensive operation that might slow down server performance.                                                                          |
| **zip**        | Allows the app to create and extract ZIP archives.                                                                                                                                                                                                                                              | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files.                                                       |
| **image**      | Allows the app to manipulate image files.                                                                                                                                                                                                                                                       | **Medium.** Potential CPU intensive operation that might slow down server performance.                                                                          |

## Module overrides (`module_override`)

**Purpose:** Let a trusted app install **request-scoped** redirects of protected module names (for example so `require('fs')` loads an app box wrapper instead of the platform `fs` module). Scripts keep writing normal `require('fs')`; middleware decides the binding.

### API

Inside any `gingee(async ($g) => { … })` for an app that has **`module_override`**:

```javascript
// box-relative path to the wrapper script (layout is entirely app-defined)
$g.overrideModule("fs", "library/fswrapper.js");
```

- **`$g.boxRelativeScript`** — path of the **main** request script relative to `box/` (e.g. `sandboxed/run.js`). Useful in `default_include` middleware to decide whether to install an override.
- Overrides apply for the **rest of that HTTP request** (ALS store). They do not affect other apps or later requests.
- Without **`module_override`**, `$g.overrideModule` throws; gbox ignores any override map entries.

### Rules (platform)

1. App must be granted **`module_override`**.
2. The **target** module (e.g. `fs`) must still be granted; override does not replace that check.
3. The wrapper path must resolve **inside the app box** (`isPathInside`).
4. When the wrapper is loaded, its own `require` tree runs with **`applyModuleOverrides: false`**, so `require('fs')` inside the wrapper is the **real platform module** (no recursion). Gingee does **not** special-case any folder name (e.g. `library/`).

### Typical pattern

```text
default_include middleware
  → if $g.boxRelativeScript is under sandboxed/
  → $g.overrideModule('fs', 'my/wrapper.js')
main script
  → require('fs')  →  app wrapper
wrapper
  → require('fs')  →  modules/fs.js (platform)
  → extra app policy (e.g. only allow writes under a subfolder)
```

Sample: **`web/appsandboxtest/`** (permissions `fs` + `module_override`).

### Security notes for operators

- This is an **app policy** hook, not a stronger OS sandbox. Platform path jails still apply when wrappers compose on platform modules.
- Grant **`module_override` only to packages you trust**. A wrapper can use **other** grants of the same app (e.g. `httpclient`, `email`, `db`) on every intercepted `require('fs')` call—folder rules do not cover those channels.
- Prefer reviewed, minimal wrappers that only call platform APIs after checks; do not grant unused High permissions alongside `module_override`.
