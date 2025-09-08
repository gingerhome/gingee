# Server Configuration Reference - The ginger.json File

The `ginger.json` file is the master configuration file for the entire GingerJS server instance. It resides in the root of your project and controls server behavior, caching policies, logging, and security settings that apply to all applications running on the platform.

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
    "prefix": "gingerjs:",
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
  - **NOTE:** See `Enabling HTTPS` section below to configure and run a HTTPS enabled GingerJS

### web_root

- **Type:** `string`
- **Default:** `"./web"`
- **Description:** The path to the directory containing all your application folders. This can be a relative path (from the project root) or an absolute path. GingerJS will fail to start if this directory does not exist.
- **Example (relative):** `"web_root": "./public"`
- **Example (absolute):** `"web_root": "/var/www/gingerjs_apps"`

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
  - **Example:** `"prefix": "my-prod-gingerjs:"`

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
- **`enabled`** (boolean): If `true`, GingerJS will compress applicable responses (like HTML, CSS, JS, and JSON) if the client's browser indicates support for it via the `Accept-Encoding` header. This significantly reduces bandwidth usage.

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
- **Privilege:** Only applications listed here are allowed to `require('platform')`, the powerful module used for application lifecycle management (creating, deleting, packaging apps, etc.). This is a critical security boundary. They can also access any Node JS built in module or third party NodeJS modules that are default included in by GingerJS (see package.json). **Ideally you will never need to set this property**
- **Example:** `["admin"]`

---

## Enabling HTTPS for Local Development

To run and test your GingerJS server with a valid SSL certificate on `localhost` (i.e., get the green padlock in your browser), you cannot use a simple self-signed certificate, as browsers do not trust them. The correct method is to create your own local Certificate Authority (CA) and use it to sign a certificate for `localhost`.

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

Now, create the `key.pem` and `cert.pem` files that GingerJS will use, and sign them with your trusted local CA.

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

**Step 4: Update `ginger.json` and Run**

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
