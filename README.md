<img src="./gingee.png" alt="Gingee" width="250"/>

# Gingee - Application Server

## **A Gen AI Project**

[**See AI Disclaimer**](./docs/ai-disclaimer.md)

The objective of the project is to validate the feasibility of GenAI in platform/framework level programming as opposed to generating simplistic applications and in the process be the world's first AI authored and human co-authored production ready application server. To ensure full transparency, a key part of the development has been the meticulous recording of the chat transcript. You can find the link to the transcript below

**[Chat Transcript](https://gingerhome.github.io/gingee-docs/docs/ai-transcript/index.html)** - Click here to see the full AI chat transcript from start of this project till date|

**What is Gingee?**

Gingee is a secure, batteries-included Node.js application server designed to dramatically accelerate web app development. Co-authored by a human architect and a GenAI partner, it provides a full featured platform that allows developers to focus on business logic instead of boilerplate. It achieves this through a secure sandbox, a powerful module ecosystem, and a comprehensive application lifecycle management system.

## **Key Features**

Gingee is a comprehensive platform designed to provide a secure, efficient, and enjoyable development experience.

- **Secure by Default**
  - **Whitelist Permissions System:** Applications have no access to the filesystem, database, or network by default. Administrators grant explicit permissions for a "secure by default" posture.
  - **Sandboxed Execution:** Every server script runs in a secure `gbox` sandbox, isolated from the host system and other applications.

- **Instant Time to Joy**
  - **All-in-One CLI:** A single command (`gingee-cli init`) scaffolds a complete, runnable project with a built-in admin panel.
  - **Simplified API:** All request/response logic is handled through a single, powerful context object (`$g`) provided by the `gingee()` middleware.
  - **Flexible Routing:** Use zero-configuration file-based routing for rapid development, or create a `routes.json` for powerful, dynamic RESTful APIs.
  - **Modern JavaScript:** Use modern ESM syntax (`import`/`from`) directly in your server scripts with zero build steps or configuration.

- **Batteries-Included Backend**
  - **Multi App Hosting:** Deploy and run multiple apps with clear isolation, individual app lifecycles and hot app reloads.
  - **Multi-Database Support:** Write your code once and deploy against PostgreSQL, SQLite, MySQL, and more, with a consistent API.
  - **Rich Standard Library:** A comprehensive suite of sandboxed modules for common tasks, including `crypto`, `image` processing, `pdf` generation, `db` access, and an `httpclient`.
  - **Application Startup Hooks:** Define `startup_scripts` to automatically run database migrations or seed data when your app is installed or upgraded.
  - **Application Middleware:** Define `default_include` to automatically inject scripts in front of all API end points of the app. Enabling easy authentication, policies, role management etc.

- **Full Lifecycle & Automation**
  - **Glade Admin UI:** A built-in, secure web panel for managing the entire application lifecycle (install, upgrade, rollback, delete, manage permissions) with no command line needed.
  - **Interactive Installers:** Both the CLI and the Glade UI feature intelligent installers that read an app's requirements, prompt the admin for permission consent, and guide them through database configuration.
  - **Automated Deployments:** All lifecycle commands in the CLI can be run non-interactively using a preset file, making it perfect for CI/CD pipelines.
  - **Automatic Maintenance Mode:** The server automatically puts an application into a `503 Service Unavailable` state during critical lifecycle events to ensure data integrity.
  - **Built for Scale:** With a pluggable distributed caching system (Redis), native service installation, and PM2 compatibility.

- **Decentralized App Store**
  - Discover and install applications from any `gstore.json` manifest on the web using the `gingee-cli`. Anyone can host their own public or private app store.

- **GenAI-Native Workflow**
  - Co-authored by a human architect and a Generative AI partner, Gingee is a testament to a new, highly efficient "Dialog-Driven Development" workflow. The project includes a pre-built knowledge bundle (`ai-context.md`) to empower you to build your own apps with an AI partner.


## **🚀 Quick Start**

Get a new, fully configured Gingee server running in under a minute.

```bash
# 1. Install the Gingee CLI
npm install -g gingee-cli

# 2. Create a new Gingee project
gingee-cli init my-gingee-project

# 3. Navigate into your new project
cd my-gingee-project

# 4. Start the server!
npm start

# 5. Browse to http://localhost:7070
```

That's it! You should now see Glade - the Gingee admin panel in your web browser.

## **Documentation**

Dive deeper into the architecture and learn how to build powerful applications with Gingee.

| Document | Description  |
| :--- | :--- |
| **[Core Concepts](./docs/concepts.md)**                             | **Start Here.** A high-level overview of the Gingee philosophy, project structure, the sandbox, and the module ecosystem. |
| **[Gingee CLI](./docs/gingee-cli.md)**                          | The all-in-one command-line interface for the Gingee platform                                                             |
| **[Server Configuration (`gingee.json`)](./docs/server-config.md)** | A full reference guide for the server-wide `gingee.json` file, controlling settings like ports, caching, and security.      |
| **[Glade Admin Panel](./docs/glade-admin.md)**                      | Glade is the official, web-based administration panel for Gingee                                                          |
| **[App Structure & `app.json`](./docs/app-structure.md)**           | A detailed breakdown of the app folder structure and a comprehensive reference for all `app.json` configuration options.    |
| **[Server Script Guide](./docs/server-script.md)**                  | Learn the anatomy of a server script and get a full API reference for the powerful `$g` global object.                      |
| **[Features](./docs/features.md)**                                  | The list of features supported by Gingee                                                                                  |
| **[App Developer Guide](./docs/app-developer-guide.md)**            | The list of features supported by Gingee                                                                                  |
| **[App Packaging Guide](./docs/packaging-guide.md)**                | Gingee platform's standardized application packaging process                                                              |
| **[App Permissions Guide](./docs/permissions-guide.md)**            | Gingee platform's app permissions ecosystem.                                                                              |
| **[GStore Hosting Guide](./docs/gstore-hosting-guide.md)**          | Gingee platform's decentralized app store hosting guide                                                                   |
| **[Full API Reference](https://gingerhome.github.io/gingee-docs/)**                     | The complete JSDoc-generated API documentation for every function in every Gingee app module.                             |
|**[API Examples](https://github.com/gingerhome/gingee-examples)** | Examples of using Gingee modules, It can also be installed in a Gingee server using the .gin package in the dist folder.|
| **[Roadmap](./docs/roadmap.html)**                                  | The roadmap of core and app features in the pipeline for the Gingee app platform                                          |

## **Credits**

| Role            | Contributor                                                  |
| :-------------- | :----------------------------------------------------------- |
| **Ideation**    | [Vignesh Swaminathan](https://www.linkedin.com/in/vigneshs/) |
| **Author**      | [Google Gemini](https://deepmind.google/models/gemini/pro/)  |
| **Co-Author**   | [Vignesh Swaminathan](https://www.linkedin.com/in/vigneshs/) |
| **Tester**      | [Vignesh Swaminathan](https://www.linkedin.com/in/vigneshs/) |
| **Tech Writer** | [Google Gemini](https://deepmind.google/models/gemini/pro/)  |
| **Reviewer**    | [Vignesh Swaminathan](https://www.linkedin.com/in/vigneshs/) |

## **Project Details**
| **Project Phase** | **Status**  | **Current Token Count**|
| :--- | :--- | :--- |
| **Phase 1**       | Completed   | 1,038,862 / 1,048,576 **(1M tokens used out of a 1M token context window)** |
| **Phase 2**       | In Progress | 699,646 / 1,048,576 **(700K tokens used out of a 1M token context window)** |

## **Tooling**
Google AI Studio, VS Code, NodeJS, NPM, JSDoc

## **Contributing**

Please see our [`CONTRIBUTING`](./docs/CONTRIBUTING.md) guide for more details on how to contribute.

## **License**

Gingee is licensed under the **MIT License**. See the `LICENSE` file for details.
