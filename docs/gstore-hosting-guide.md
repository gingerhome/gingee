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
