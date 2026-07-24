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
  "email": {
    "type": "console"
  },
  "ai": {
    "type": "mock"
  },
  "scheduler": {
    "enabled": false,
    "timezone": "UTC"
  },
  "limits": {
    "request_timeout_ms": 30000,
    "request_timeout_stream_ms": 300000,
    "stream_idle_timeout_ms": 60000,
    "outbound_timeout_ms": 15000,
    "max_concurrent_requests": 100,
    "max_concurrent_requests_per_app": 25,
    "max_concurrent_outbound": 50
  },
  "egress": {
    "mode": "protected",
    "https_only": false,
    "dns_check": true,
    "max_redirects": 3,
    "allow_hosts": [],
    "allow_cidrs": []
  },
  "secrets": {
    "load_dotenv": false,
    "required": true,
    "file_roots": ["./settings/secrets", "/run/secrets"]
  },
  "metrics": {
    "enabled": true,
    "path": "/metrics",
    "allow_from": ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
    "bearer_token": null
  },
  "audit": {
    "enabled": true,
    "path": "./logs/audit.jsonl"
  },
  "isolation": {
    "mode": "off",
    "default": "inprocess",
    "apps": [],
    "groups": {},
    "auto_restart": true,
    "restart_max": 10
  },
  "websockets": {
    "enabled": true,
    "max_connections": 10000,
    "max_connections_per_app": 2000,
    "max_message_bytes": 65536,
    "idle_timeout_ms": 300000,
    "heartbeat_ms": 30000,
    "default_path": "/ws"
  },
  "queue": {
    "enabled": true,
    "driver": "memory",
    "concurrency": 5,
    "default_attempts": 3,
    "default_backoff_ms": 1000,
    "jobs_dir": "jobs",
    "redis": {
      "url": null,
      "host": "127.0.0.1",
      "port": 6379,
      "key_prefix": "gingee:queue:"
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

### email

- **Type:** `object` (optional)
- **Description:** Optional **server-wide default** for the transactional `email` module. Each app may override this with `app.json` → `email`. There is a single config object (no named profiles). Apps still need the `email` permission to call `require('email')`.
- **`type`** (string): Provider id. Supported in v1: `"console"` (log only, for local dev) or `"sendgrid"`.
- **`api_key`** (string, optional): SendGrid API key when using `"sendgrid"`.
- **`from`** / **`from_name`** (string, optional): Default sender identity.
- **Runtime override:** App scripts may call `email.sendWithConfig(config, message)` to override server + app config for a single send.

### ai

- **Type:** `object` (optional)
- **Description:** Optional **server-wide default** for the generative `ai` module. Apps override with `app.json` → `ai`. Requires the `ai` permission.
- **`type`** (string): `"mock"` | `"gemini"` | `"xai"` (`xai` / Grok is P1 stub).
- **`api_key`** (string): Cloud provider key.
- **`default_model`**, **`default_vision_model`** (string, optional)
- **`safety`** (object, optional): content safety defaults.
- **Streaming:** apps use `ai.chatStream(...)` (async iterator).

### scheduler

- **Type:** `object` (optional)
- **Description:** Controls the in-process **CRON scheduler** for this Gingee node. App jobs are declared in each app’s `app.json` → `schedules` (see [App Structure](./app-structure.md)). Targets: `"script"`, `"url"`, or **`"queue"`** (enqueue a background job — preferred when `queue.driver` is `redis` on multiple nodes).
- **`enabled`** (boolean):
  - **Default:** `false`
  - When `false`, this node does **not** register or fire any schedules (safe default for multi-server load-balanced fleets).
  - When `true`, this node registers schedules for all installed apps that have the `scheduler` permission and valid `schedules` entries.
  - **Multi-server:** for `"script"` / `"url"` targets, enable on **at most one** node. For `"queue"` targets with a shared Redis queue, every node may run the scheduler **or** only one — jobs still process once via the queue.
- **`timezone`** (string, optional):
  - **Default:** `"UTC"`
  - Default IANA timezone for jobs that omit `timezone` in `app.json`.

### limits

- **Type:** `object` (optional)
- **Description:** Platform **timeouts and concurrency** for this Gingee node. Protects the shared process from hung scripts, stuck outbound HTTP, and request storms. Safe defaults apply when omitted.
- **App override:** optional `app.json` → `limits` may only **tighten** (lower) these ceilings, never raise them.

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `request_timeout_ms` | `30000` | Wall-clock budget for a non-streaming server script (starts when the script runs). On expiry: **504** JSON and request abort signal. |
| `request_timeout_stream_ms` | `300000` | Hard cap after `$g.response.startStream()` (e.g. AI SSE). |
| `stream_idle_timeout_ms` | `60000` | If no `write` / `writeSSE` for this long while streaming, the stream is ended (**504** / error SSE). |
| `outbound_timeout_ms` | `15000` | Default `httpclient` axios timeout when the app omits `options.timeout` (also a ceiling for explicit timeouts). Clamped to remaining request budget when not streaming. |
| `max_concurrent_requests` | `100` | Max in-flight **server scripts** process-wide (static files are not counted). Over limit → **503** `TOO_MANY_REQUESTS`. |
| `max_concurrent_requests_per_app` | `25` | Max in-flight scripts per app. Over limit → **503**. |
| `max_concurrent_outbound` | `50` | Max concurrent `httpclient` calls process-wide. Over limit → status **503** from httpclient. |
| `headers_timeout_ms` | `60000` | Node HTTP `server.headersTimeout`. |
| `request_timeout_server_ms` | `120000` | Node HTTP `server.requestTimeout` (whole connection). |
| `keep_alive_timeout_ms` | `5000` | Node HTTP keep-alive. |

**Notes:**

- Timeouts are **best-effort** for async I/O. Pure CPU spin in a script is not preempted (shared event loop).
- Streaming uses idle + hard caps so AI token streams are not killed at 30s.
- Scheduler jobs use their own `timeout_ms` and do **not** consume HTTP concurrency slots.

### egress

- **Type:** `object` (optional)
- **Description:** Outbound URL policy (**SSRF hardening**) for `require('httpclient')` and scheduler **URL** jobs. Defaults to **protected** mode. See also the [Threat Model](./threat-model.md).

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `mode` | `"protected"` | `"protected"` — block private/loopback/link-local/metadata, allow public internet. `"allowlist"` — only `allow_hosts` / `allow_cidrs`. `"off"` — no checks (local dev only). |
| `https_only` | `false` | When `true`, reject `http:` URLs. |
| `dns_check` | `true` | In `protected` mode, resolve hostnames and deny if any address is blocked. |
| `max_redirects` | `3` | Max HTTP redirects; **each hop is re-validated**. |
| `block_private` / `block_loopback` / `block_link_local` / `block_metadata` | `true` | Class blocks used in `protected` mode. Metadata hostnames/IPs are force-blocked in `protected` and `allowlist`. |
| `allow_hosts` | `[]` | Exact host or `*.example.com` patterns (exceptions / allowlist entries). |
| `allow_cidrs` | `[]` | CIDR exceptions (e.g. `"10.0.0.0/8"`) for intentional private access. |
| `deny_hosts` / `deny_cidrs` | `[]` | Extra denials. |

**Examples:**

```json
"egress": { "mode": "protected", "allow_cidrs": ["10.0.1.0/24"] }
```

```json
"egress": { "mode": "off" }
```

Denied `httpclient` calls return **403** with `code: "EGRESS_DENIED"`. Scheduler URL jobs fail registration/run with a clear log line.

### secrets

- **Type:** `object` (optional)
- **Description:** How the engine resolves **secret references** in `gingee.json` and each app’s `app.json` at load/reload time. Apps still **cannot** read host `process.env` from sandbox code; the engine injects resolved values into in-memory config only. See [Threat Model](./threat-model.md).

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `load_dotenv` | `false` | When `true`, load project-root `.env` into `process.env` for keys not already set (local Joy). |
| `required` | `true` | Missing `env:` / `file:` targets throw at load time (fail closed). |
| `file_roots` | `["./settings/secrets", "/run/secrets"]` | Absolute or project-relative directories allowed for `file:` secrets. Paths outside these roots are rejected. |

**Reference syntax** (any string config value, including nested fields):

| Form | Example |
| :--- | :--- |
| Env | `"jwt_secret": "env:GINGEE_MYAPP_JWT_SECRET"` |
| File | `"password": "file:./settings/secrets/myapp_db_password"` |
| Object | `"api_key": { "$secret": "env:SENDGRID_KEY", "required": true }` |

**Literal values still work** (dev): `"jwt_secret": "dev-only-secret"`.

**Examples of fields that commonly use refs:** `jwt_secret`, `db[].password`, `email.api_key`, `ai.api_key`, `cache.redis.password`.

### metrics

- **Type:** `object` (optional)
- **Description:** Engine-scoped **Prometheus** exposition for observability (Grafana, etc.). Not an application route and not available via sandboxed `require`—scrape the HTTP path on the server itself. Prefer keeping scrapes on localhost or a private network interface; do not expose `/metrics` on the public internet without a reverse proxy ACL and optional bearer token.

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `enabled` | `true` | When `false`, the metrics path is not served. |
| `path` | `"/metrics"` | HTTP path for scrapes (must start with `/`). |
| `allow_from` | `["127.0.0.1", "::1", "::ffff:127.0.0.1"]` | Socket remote addresses allowed to scrape. **Empty array = allow all** (not recommended). Uses the TCP peer address only—`X-Forwarded-For` is **not** trusted. |
| `bearer_token` | `null` | If set (literal or `env:` / `file:` secret ref), require `Authorization: Bearer <token>`. |

**Series (high level):** HTTP request counts/durations (by app, kind, status class), concurrency reject counters, egress deny reasons, scheduler job run outcomes, WebSocket upgrade results / open connection gauges, queue enqueue/complete/fail/retry counters and duration histogram, in-flight gauges, process memory, app/job counts.

**Scrape example (local):**

```bash
curl -s http://127.0.0.1:7070/metrics
```

### audit

- **Type:** `object` (optional)
- **Description:** Append-only **JSONL** audit trail for privileged platform actions: permission changes and app lifecycle (install, upgrade, reload, delete, rollback, register). Written by the engine when Glade / `platform` APIs mutate state—not request-level access logs.

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `enabled` | `true` | When `false`, no audit file is written. |
| `path` | `"./logs/audit.jsonl"` | Absolute or project-relative path to the audit log file. Parent directories are created if needed. |

Each line is one JSON object, for example:

```json
{"ts":"2026-07-18T12:00:00.000Z","event":"permission.set","actor":"glade","app":"myapp","details":{"previous":["fs"],"granted":["fs","db"]}}
```

| Field | Meaning |
| :--- | :--- |
| `event` | Stable name: `permission.set`, `app.install`, `app.upgrade`, `app.reload`, `app.delete`, `app.rollback`, `app.register` |
| `actor` | Privileged app that performed the action when available; otherwise `system` |
| `app` | Target application name |
| `details` | Event-specific payload (previous/granted permissions, versions, etc.) |

### isolation

- **Type:** `object` (optional)
- **Description:** Opt-in **process isolation** for server scripts. When enabled, selected apps run box scripts in a **child process** (IPC). The public HTTP(S) ports remain those under `server` — the master accepts connections; workers do not listen on ports. **Default is off** (all apps in-process, same as before).

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `mode` | `"off"` | `"off"` = never use workers. `"process"` = allow workers per policy below. |
| `default` | `"inprocess"` | When `mode` is `"process"`, apps without an explicit flag use `"inprocess"` or `"process"`. |
| `apps` | `[]` | App folder names that each get a **solo** worker (`app:<name>`) when `mode` is `"process"`. |
| `groups` | `{}` | Map of group id → app name list; members share **one** worker (`group:<id>`). Membership alone isolates them—**no need** to also list them in `apps`. |
| `worker_ready_timeout_ms` | `15000` | Max wait for a worker to become ready after fork. |
| `request_timeout_ms` | `120000` | Max wait for a worker script (buffered or stream) to finish. |
| `auto_restart` | `true` | Restart workers after unexpected exit (not after intentional stop/reload). |
| `restart_max` | `10` | Max automatic restarts before staying down until next request/reload. |
| `restart_delay_ms` | `500` | Base backoff delay (doubles each attempt). |
| `restart_backoff_max_ms` | `30000` | Cap on backoff delay. |
| `restart_stable_ms` | `60000` | After this long ready without crash, restart counter resets. |

**Per-app** (`app.json`): `"isolation": "process"` or `"isolation": "inprocess"`.

**How apps are selected (when `mode` is `"process"`):**

| Source | Effect |
| :--- | :--- |
| `app.json` `"isolation": "process"` | Solo worker unless the app is also in a **group** |
| `isolation.apps` | Same as solo opt-in by name |
| `isolation.groups` | Shared worker for all listed members that are installed |
| `default: "process"` | Every non-privileged app isolated (use carefully) |
| `privileged_apps` (e.g. Glade) | **Always** stay in-process |

If an app appears in both `apps` and a group, the **group wins** (one shared worker).

**Runtime rules:**

- **Buffered** and **SSE/stream** (`startStream` / `writeSSE` / `endStream`) are supported over IPC.
- Static files and SPA routing stay on the master.
- Workers re-initialize process-local adapters (`ai`, `email`) from the app config snapshot so `app.json` AI/email config works in isolated apps (permissions still required).
- **Groups** share one Node worker (density within a trust set); not hostile multi-tenant isolation.
- Unexpected worker exit triggers **auto-restart** with backoff (unless disabled or `restart_max` exceeded).

```json
"isolation": {
  "mode": "process",
  "default": "inprocess",
  "apps": ["untrusted-app"],
  "groups": {
    "tenant-a": ["app-one", "app-two"]
  },
  "auto_restart": true,
  "restart_max": 10,
  "restart_delay_ms": 500,
  "restart_backoff_max_ms": 30000,
  "restart_stable_ms": 60000
}
```

In this example: `untrusted-app` → worker `app:untrusted-app`; `app-one` and `app-two` (if installed) → shared worker `group:tenant-a`; all other apps stay on the master.

### websockets

- **Type:** `object` (optional)
- **Description:** Master-owned **WebSocket** upgrade support on the same HTTP(S) ports as normal traffic. Apps opt in via `app.json` → `websockets` and must be granted the **`websockets`** permission. Connections always terminate on the **master** (not isolation workers). For one-shot progressive HTTP output, prefer SSE (`startStream` / `writeSSE`).

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `enabled` | `true` | Global kill switch. When `false`, no upgrades are accepted. |
| `max_connections` | `10000` | Max open sockets server-wide. |
| `max_connections_per_app` | `2000` | Max open sockets per app. |
| `max_message_bytes` | `65536` | Max inbound message size (also `ws` maxPayload). |
| `idle_timeout_ms` | `300000` | Close sockets idle longer than this (activity = message or pong). |
| `heartbeat_ms` | `30000` | Server ping interval; also drives idle checks. |
| `default_path` | `"/ws"` | Used when an app omits `websockets.path`. Full URL is `/{appName}{path}`. |

**Per-app** (`app.json`):

```json
"websockets": {
  "enabled": true,
  "path": "/ws",
  "handler": "realtime/handler.js",
  "auth": "realtime/auth.js",
  "allowed_origins": ["https://app.example.com"]
}
```

| Field | Required | Meaning |
| :--- | :--- | :--- |
| `enabled` | no | Set `false` to disable; presence of `handler` is enough to enable when permission is granted |
| `path` | no | Path under the app (default server `default_path`). Client connects to `ws(s)://host/{appName}{path}` |
| `handler` | **yes** | Box-relative script exporting `async function (socket, ctx)` |
| `auth` | no | Box-relative script run on upgrade; return `false` / `{ ok: false }` to reject |
| `allowed_origins` | no | If set, `Origin` must match exactly |

**Multi-tenant apps:** rooms are app-global. Prefix with `require('websockets').tenantRoom(tenantId, name)` → `t:{tenantId}:{name}`.

**Reload / delete:** app reload re-binds the handler and closes that app’s sockets.

**Sample app:** `web/ginchat/` — multi-tenant room chat + HTTP announce (`POST /ginchat/api/announce`). Open `/ginchat/` after granting the `websockets` permission and restarting/reloading.

**Metrics:** `gingee_websocket_upgrades_total`, `gingee_websocket_connections_opened_total` / `_closed_total`, gauges `gingee_websocket_connections` and `gingee_websocket_connections_per_app`.

### queue

- **Type:** `object` (optional)
- **Description:** Background **job queue**. Apps enqueue work with `require('queue').add(name, payload)`; handlers live under `box/jobs/{name}.js` (or paths mapped in `app.json` → `queue.jobs`). Requires the **`queue`** permission. Default driver is **memory** (single process, not durable). Use **redis** for multi-node shared work and durable jobs (uses existing `ioredis`).

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `enabled` | `true` | When `false`, enqueue and processing are off. |
| `driver` | `"memory"` | `"memory"` or `"redis"`. |
| `concurrency` | `5` | Max jobs running at once on this node. |
| `default_attempts` | `3` | Retries after handler failure (exponential backoff). |
| `default_backoff_ms` | `1000` | Base delay between retries. |
| `jobs_dir` | `"jobs"` | Default folder under `box/` for job scripts. |
| `redis` | see defaults | `url` or `host`/`port`/`password`/`db`/`key_prefix` when `driver` is `redis`. |

```json
"queue": {
  "enabled": true,
  "driver": "redis",
  "concurrency": 10,
  "redis": { "url": "env:REDIS_URL", "key_prefix": "gingee:queue:" }
}
```

**App (`app.json` optional):**

```json
"queue": {
  "jobs": {
    "send-welcome": { "script": "jobs/send_welcome.js" }
  }
}
```

**Handler example (`box/jobs/echo.js`):**

```javascript
module.exports = async function () {
  await gingee(async ($g) => {
    const { payload, attempt, id } = $g.queue;
    // do work…
  });
};
```

**From a server script:**

```javascript
const queue = require('queue');
await queue.add('echo', { hello: true }, { delayMs: 0, attempts: 3 });
```

**CRON → queue (multi-node friendly):** schedule target `"type": "queue", "job": "nightly"` enqueues instead of running the heavy work inline. App needs both `scheduler` and `queue` permissions; server needs `scheduler.enabled` and `queue.enabled`.

**Metrics:** `gingee_queue_jobs_enqueued_total`, `_completed_total`, `_failed_total`, `_retried_total`, histogram `gingee_queue_job_duration_seconds`.

### Optional npm feature packages

Gingee keeps a **core** set of required dependencies (engine, SQLite, sharp image, zip, auth crypto, etc.) and marks specialized packages as **`optionalDependencies`** in `package.json`:

| Feature | Packages |
| :--- | :--- |
| PostgreSQL / MySQL / MSSQL / Oracle | `pg`, `mysql2`, `mssql`, `oracledb` |
| Charts / canvas barcodes / dashboard | `chartjs-node-canvas`, `canvas` |
| PDF | `pdfmake` |
| SendGrid email | `@sendgrid/mail` |
| Gemini AI | `@google/generative-ai` |

**Install behavior (npm):**

- Default `npm install` **still attempts** optional packages (full batteries when builds succeed).
- If an optional package **fails to compile** (common for Oracle / canvas), install **continues** — core Gingee still works.
- **Slim install:** `npm install --omit=optional`, then add only what you need, e.g. `npm install pg @sendgrid/mail`.

Using a feature without its package throws **`FEATURE_NOT_INSTALLED`** with the package name. SQLite (`better-sqlite3`), email `type: "console"`, and AI `type: "mock"` do not require optionals.

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
- **Description:** Configures the security settings for the `gbox` sandbox environment. App scripts run in a **Node `vm` context** without host `process` / real `global` access (see [Threat Model](./threat-model.md)).
- **`allowed_modules`** (array of strings): A whitelist of Node.js built-in modules that sandboxed scripts are allowed to `require()`. Dangerous modules (`child_process`, `vm`, host `node:fs`, etc.) are **always forbidden**. Prefer leaving this empty. Safe defaults already include `url`, `querystring`, and `mime-types`.
- **`allow_code_generation`** (boolean, optional):
  - **Default:** `true` (Instant Time to Joy — many UMD/minified libs such as Handlebars need `new Function` at load time).
  - When `true`, string `eval` / `Function` work **inside the app vm only**. Host **`process` remains unavailable**; apps cannot read `process.env`.
  - Set to `false` for a stricter lockdown when you do not load such libraries (disables string codegen in the sandbox).
- **Example (stricter):**
```json
"box": {
  "allowed_modules": [],
  "allow_code_generation": false
}
```

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
