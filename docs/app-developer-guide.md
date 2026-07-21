# Gingee: The App Developer's Guide

Welcome to Gingee! This guide is your starting point for building powerful, secure, and modern applications on the Gingee platform. We'll take you from a simple "Hello World" to a complete, database-backed RESTful API.

If you haven't already, please read the Core Concepts [MD](./concepts.md) [HTML](./concepts.html) guide for a high-level overview of the platform's architecture.

**NOTE:**
This guide focuses on creating a Gingee backend with the classic Multi-Page App (MPA) workflow. For a complete tutorial on building modern SPAs with frameworks like React, Vue, or Angular, please see our dedicated Gingee SPA Developer's Guide [MD](./app-spadev-guide.md) [HTML](./app-spadev-guide.html)

## Chapter 1: Your First App - Hello World (MPA)

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

## Chapter 5a: Secrets in config (env / file refs)

Do not commit production API keys or DB passwords into `app.json` when you can avoid it. Use **secret references**; the engine resolves them at load time:

```json
"jwt_secret": "env:GINGEE_MYAPP_JWT_SECRET",
"ai": { "type": "gemini", "api_key": "env:GINGEE_MYAPP_GEMINI_KEY" }
```

```bash
export GINGEE_MYAPP_JWT_SECRET=...
export GINGEE_MYAPP_GEMINI_KEY=...
npm start
```

Or Docker/K8s file mounts:

```json
"password": "file:./settings/secrets/myapp_db_password"
```

(with the file under `secrets.file_roots` from `gingee.json`).

Sandbox scripts **cannot** read `process.env` (host isolation). The engine resolves refs into your app’s config in memory only. See [Server Config](./server-config.md) → `secrets` and the [Threat Model](./threat-model.md).

### Process isolation (optional)

If the operator enables `gingee.json` → `isolation.mode: "process"`, your app may run **server scripts** in a child process when marked with `"isolation": "process"` in `app.json` (or listed under server `isolation.apps`). HTTP still enters on the same server port; only script execution is isolated. **Streaming** (`startStream` / SSE) is not supported in workers in v1—keep AI/stream apps in-process. Privileged apps such as Glade never use workers. Details: [Server Config](./server-config.md) → `isolation`.

## Chapter 5b: Email and Generative AI Modules

Two permission-protected integration modules follow the same adapter pattern as `db` and `cache`.

### Transactional email (`require('email')`)

1. Configure a single email object in `app.json` (optional server defaults in `gingee.json`).
2. Declare `"email"` in `pmft.json` / grant it in Glade.
3. Send mail from a server script:

```javascript
module.exports = async function () {
    await gingee(async ($g) => {
        const email = require('email');
        const result = await email.send({
            to: $g.request.body.to,
            subject: 'Welcome',
            text: 'Thanks for joining.',
            html: '<p>Thanks for joining.</p>'
        });
        // result: { messageId, provider, status }
        $g.response.send(result);
    });
};
```

Use `email.sendWithConfig(configOverride, message)` when a single send must use different credentials or `from` than `app.json` / `gingee.json` (override applies to that call only).

Providers: `console` (logs only; great for local dev), `sendgrid` (`api_key`, `from`, optional `from_name`).

### Generative AI (`require('ai')`)

1. Configure a single `ai` object in `app.json` (optional server defaults in `gingee.json`).
2. Grant the `"ai"` permission.
3. Call the unified API:

```javascript
module.exports = async function () {
    await gingee(async ($g) => {
        const ai = require('ai');

        // Non-streaming
        const reply = await ai.chat({
            messages: [{ role: 'user', content: $g.request.body.prompt }],
            model: 'gemini-2.5-pro',      // optional per-call model
            temperature: 0.4,             // optional
            maxTokens: 2048               // optional
        });
        // reply.text, reply.model, reply.provider, reply.usage { inputTokens, outputTokens }

        $g.response.send({
            text: reply.text,
            usage: reply.usage
        });
    });
};
```

**Streaming** uses `ai.chatStream` with `$g.response.startStream` / `writeSSE` / `endStream` (see [Server Script Guide](./server-script.md)).

Other methods: `ai.complete`, `ai.parseDocument`, `ai.moderate`. Per-call provider override: second argument `{ config: { type, api_key, … } }`.

Providers: `mock` (offline), `gemini` (Google); `xai` (Grok) is reserved for a future release.

Full config field reference: [App Structure](./app-structure.md) and [Server Config](./server-config.md).

## Chapter 5c: Scheduled Jobs (CRON)

For recurring background work, declare jobs in `app.json` → `schedules` instead of inventing timers inside request handlers.

1. Set `"scheduler": { "enabled": true }` in **`gingee.json`** on the node that should run jobs (default is `false`; use **one** node only under load balancing).
2. Grant the app the **`scheduler`** permission (and **`httpclient`** if any job uses a URL target).
3. Add schedules and implement scripts under `box/`:

```json
"schedules": [
  {
    "name": "nightly_cleanup",
    "cron": "0 2 * * *",
    "timezone": "UTC",
    "payload": { "mode": "full" },
    "target": { "type": "script", "path": "jobs/cleanup.js" }
  }
]
```

```javascript
// box/jobs/cleanup.js
module.exports = async function () {
    await gingee(async ($g) => {
        // $g.request.method === 'SCHEDULE'
        // $g.schedule.name, $g.schedule.runId, $g.request.body ← payload
        const fs = require('fs');
        const db = require('db');
        // Prefer a leading "/" so the path is relative to box/ (not to jobs/)
        await fs.writeFile(fs.BOX, '/data/last-run.json', JSON.stringify({
            at: new Date().toISOString(),
            runId: $g.schedule.runId
        }), 'utf8');
        $g.response.send({ ok: true }); // logged; not an HTTP response
    });
};
```

Without a leading `/`, `fs` paths are relative to the **script folder** (e.g. `data/x.json` from `jobs/cleanup.js` → `box/jobs/data/x.json`). Use a leading `/` when an HTTP script under `box/` must read the same file as a job under `box/jobs/`.

External webhooks use `"target": { "type": "url", "url": "https://…", "method": "POST", … }`. URL targets (and all `httpclient` calls) are subject to server **egress** SSRF policy—public HTTPS APIs work by default; localhost/private/metadata are blocked unless the operator configures `allow_cidrs` / `allow_hosts` or `egress.mode: "off"` for local dev.

See [App Structure](./app-structure.md) for the full field list and [Server Config](./server-config.md) for the server gate, `limits`, and `egress`.

## Chapter 6: A New Paradigm - Building with a GenAI Partner

Gingee was co-authored with a Generative AI, and you can leverage this same powerful workflow to build your own applications. The key is to provide the AI with a "knowledge bundle" of the platform's architecture. We've created this for you.

**How to Start a Development Session with an AI:**

1.  **Get the Context File:** Locate the pre-built `docs/ai-context/ai-context.md` file in the Gingee repo. This file contains all the core concepts and API references of Gingee that an AI needs.

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
