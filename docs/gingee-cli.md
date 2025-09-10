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
