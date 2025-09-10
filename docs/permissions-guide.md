# Gingee Permissions Guide

Security is a core principle of the Gingee platform. The permissions system is designed to be **secure by default**, following the **Principle of Least Privilege**. This guide explains how permissions are declared by developers and managed by administrators to create a safe and predictable server environment.

## The Philosophy: Secure by Default (Whitelist Model)

Gingee operates on a strict **whitelist model**. By default, a sandboxed application has **no access** to potentially sensitive modules like the filesystem (`fs`), database (`db`), or outbound HTTP client (`httpclient`).

Access to these protected modules must be explicitly **granted** by a server administrator. If a permission has not been granted, any attempt by an app to `require()` that module will result in a security error, and the script will fail to execute.

This model ensures that administrators have full control and awareness of an application's capabilities.

## For App Developers: Declaring Permissions (`pmft.json`)

When you build an application that you intend to distribute (as a `.gin` file) or share, you must declare the permissions it requires in a manifest file. This file acts as a formal request to the administrator who will install your app.

-   **File Name:** `pmft.json` (Permissions Manifest)
-   **Location:** `web/<your-app-name>/box/pmft.json`

The `gingee-cli` will read this file directly from your `.gin` package during installation to prompt the administrator for consent.

### Structure of `pmft.json`

The file contains a single `permissions` object with two keys: `mandatory` and `optional`.

-   **`mandatory`**: An array of permission keys that are **essential** for your app's core functionality. If the administrator denies a mandatory permission, the installation process should be aborted.
-   **`optional`**: An array of permission keys for features that are enhancements but not critical. Your application code should be written to handle cases where an optional permission is not granted.

**Example `pmft.json` for a blog application:**
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
*In this example, the blog requires database and filesystem access to function. It has an optional feature (perhaps for checking for updates) that requires outbound HTTP calls. This file is the definitive source of truth that the `gingee-cli` will use to generate the interactive consent prompts for the administrator during installation.*

## For Administrators: Managing Permissions

As a server administrator, you have the final authority on what an application is allowed to do. Permissions are managed in a central, server-wide file and can be easily edited via the Glade admin panel.

### The Central Permissions File (`settings/permissions.json`)

This file is the single source of truth for all application grants on your Gingee server.

-   **Location:** `project_root/settings/permissions.json`
-   **Structure:** A JSON object where each key is an application's name. The value is an object containing a `granted` array.

**Example `settings/permissions.json`:**
```json
{
  "glade": {
    "granted": [
      "platform",
      "fs"
    ]
  },
  "my-blog-app": {
    "granted": [
      "db",
      "fs"
    ]
  }
}
```
*In this example, `my-blog-app` was granted its two mandatory permissions, but the administrator chose not to grant the optional `httpclient` permission.*

### Managing Permissions in Glade

The easiest way to manage permissions is through the Glade admin panel. On the main dashboard, each application has a **Permissions** button. Clicking this button will open a modal window where you can safely grant or revoke permissions from the master list.

Saving your changes in this modal will automatically update the `settings/permissions.json` file and trigger a safe reload of the application to immediately apply the new security rules.

## Master Permission List

This is the definitive list of all permission keys available in Gingee.

| Permission Key | Description | Security Implication |
| :--- | :--- | :--- |
| **platform** | **PRIVILEGED.** Allows the app to use the `platform` module to manage the lifecycle (install, delete, upgrade, etc.) of other applications on the server. | **Critical.** This is the highest level of privilege. Only grant this to a fully trusted administration application like `glade`. |
| **cache** | Allows the app to use the caching service for storing and retrieving data. | **High.** Grants access to the centralized cache service. Cache access is isolated for app specific data. |
| **db** | Allows the app to connect to and query the database(s) configured for it in `app.json`. | **High.** Grants access to the application's primary data store. |
| **httpclient** | Permits the app to make outbound HTTP/HTTPS network requests to any external API or website. | **High.** The app can send data to or receive data from any server on the internet. |
| **fs** | Grants full read/write access to files and folders within the app's own secure directories (`box` and `web`). | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files. |
| **pdf** | Allows the app to generate and manipulate PDF documents. | **Medium.** Potential CPU intensive operation that might slow down server performance. |
| **zip** | Allows the app to create and extract ZIP archives. | **Medium.** Access is jailed to the app's own directory, preventing access to other apps or system files. |
| **image** | Allows the app to manipulate image files. | **Medium.** Potential CPU intensive operation that might slow down server performance. |

