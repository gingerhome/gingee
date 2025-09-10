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
