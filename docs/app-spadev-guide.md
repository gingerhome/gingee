# Gingee: The Modern SPA Developer's Guide

Welcome! This guide provides a complete walkthrough for developing, testing, building, and distributing a modern Single Page Application (SPA) using frameworks like React, Vue, or Angular on the Gingee platform.

We will follow Gingee's "Instant Time to Joy" philosophy by creating a seamless development environment that combines the power of a secure Gingee backend with the rich tooling of the modern frontend ecosystem.

### Chapter 1: Core Concepts for SPA Hosting

Gingee achieves first-class SPA support through two core mechanisms:

1.  **Development Server Proxy:** In development mode, the Gingee server acts as the single point of entry. It intelligently serves your backend API from the `box` folder while automatically proxying all other requests (for your UI, assets, etc.) to your frontend's native hot-reloading dev server (like Vite or the Angular CLI). This creates a unified, CORS-free environment with a single command.

2.  **Production Fallback Routing:** In production mode, the proxy is disabled. Gingee serves your compiled frontend assets from a build directory (e.g., `dist/`). Any request that does not match a backend API route or a specific static asset is automatically "forwarded" to serve your SPA's main `index.html` file. This allows client-side routing libraries like React Router to take control of the URL and render the correct view.

### Chapter 2: Scaffolding Your SPA Backend

The first step is to create a Gingee application that is pre-configured for SPA hosting.

**1. Run the `add-app` Command**

From the root of your Gingee project, run the following command:

```bash
gingee-cli add-app my-spa
```

**2. Select the SPA Type**

In the interactive wizard, choose the `SPA` option:

```
? What type of app is this? (Use arrow keys)
  MPA (Multi-Page App, classic Gingee for static sites or server-side logic)
❯ SPA (Single Page App, for modern frontends like React, Vue, Angular)
```

The CLI will create a minimal backend structure at `web/my-spa/`, which includes the secure `box` folder, a sample API endpoint, and, most importantly, a pre-configured `app.json`.

**3. Understand the `app.json` Configuration**

The generated `web/my-spa/box/app.json` is the key to enabling SPA mode:

```json
{
  "name": "my-spa",
  "version": "1.0.0",
  "type": "SPA",
  "mode": "development",
  "spa": {
    "enabled": true,
    "dev_server_proxy": "http://localhost:5173",
    "build_path": "./dist",
    "fallback_path": "index.html"
  },
  "db": []
}
```

*   `"type": "SPA"`: Tells the Gingee engine to use the SPA routing logic.
*   `"mode": "development"`: **Crucial for development.** This activates the dev server proxy. Switch this to `"production"` when you are ready to build and deploy.
*   `"spa.dev_server_proxy"`: The URL of your frontend's dev server. You may need to change the port to match your tooling (e.g., `http://localhost:4200` for Angular).
*   `"spa.build_path"`: The path to your compiled frontend assets, relative to the app's root (`web/my-spa/`). **`./dist`** is a common default.
*   `"spa.fallback_path"`: The entry point file for your SPA, located inside the `build_path`.

### Chapter 3: Setting Up Your Frontend

Gingee is framework-agnostic. You can now use the official CLI for your chosen framework to initialize your project *inside* the `web/my-spa/` directory.

**Example using Vite + React + TypeScript:**

1.  **Navigate into your app's directory:**
    ```bash
    cd web/my-spa
    ```

2.  **Initialize the Vite project in the current folder:**
    ```bash
    # The '.' tells Vite to use the current directory
    npm create vite@latest
    ```

3.  **Install frontend dependencies:**
    ```bash
    npm install
    ```

4.  **Configure the `base` Path (CRITICAL STEP)**
    You **must** tell your frontend build tool that the application will be served from a subpath. For Vite, you do this by editing `vite.config.js`.

    ```javascript
    // File: web/my-spa/vite.config.js
    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'

    export default defineConfig({
      plugins: [react()],
      // This ensures all asset paths are correctly prefixed with /my-spa/
      base: '/my-spa/', 
    })
    ```

### Chapter 4: The Unified Development Experience

With the backend and frontend now in place, you can start both with a single command.

1.  **Navigate back to the Gingee project root:**
    ```bash
    cd ../..
    ```
2.  **Start the server:**
    ```bash
    npm run dev
    ```

Gingee will start, automatically launch your Vite dev server, and begin proxying requests. You can now navigate to `http://localhost:7070/my-spa`, and your React application will load with full hot-reloading capabilities.

Any `fetch` call from your React app to a relative path like `/my-spa/api/hello` will be seamlessly handled by the Gingee backend, with no CORS errors.

### Chapter 5: Building for Production

When you are ready to deploy, you need to create an optimized production build of your frontend.

1.  **Navigate into your app's directory:**
    ```bash
    cd web/my-spa
    ```
2.  **Run your build script:**
    ```bash
    npm run build
    ```
    This will create the `dist` folder containing your compiled assets.

### Chapter 6: Preparing for Distribution

Before packaging, create two manifest files in your app's `box` folder.

**1. Permissions Manifest (`pmft.json`)**
Declare all the Gingee modules your backend API needs. See Permissions Guide [MD](./permissions-guide.md) [HTML](./permissions-guide.html)

```json
// File: web/my-spa/box/pmft.json
{
  "permissions": {
    "mandatory": [ "db"],
    "optional": []
  }
}
```

**2. Package Contents Manifest (`.gpkg`)**
Specify which files to include in the final `.gin` package. **Crucially, you must include the `dist` folder and exclude development source files.**

```json
// File: web/my-spa/box/.gpkg
{
  "include": [
    "box/**/*",
    "dist/**/*"
  ],
  "exclude": [
    "src",
    "node_modules",
    ".gitignore",
    "vite.config.js",
    "*.lock",
    "tsconfig.json",
    "tsconfig.node.json"
  ]
}
```

### Chapter 7: Packaging and Deployment

With the frontend built and manifests in place, you are ready to create your distributable Gingee application package.

1.  **Set `app.json` to Production Mode:** Change `"mode": "development"` to `"mode": "production"` in your `app.json`.
2.  **Package the App:** From your Gingee project root, run:
    ```bash
    gingee-cli package-app --appName my-spa
    ```
3.  **Deploy:** This will create a `my-spa-v1.0.0.gin` file. You can now deploy this single file to any production Gingee server using the `gingee-cli install-app` or `upgrade-app` commands.

Congratulations! You have successfully built and packaged a modern Single Page Application on the Gingee platform
