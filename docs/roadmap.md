# Gingee Roadmap

Gingee has a strong, stable, and feature-rich foundation. Our core focus on security, developer experience, and a modular, multi-database architecture is complete. This document outlines our vision for the future of the platform, detailing the features and enhancements we are planning to build next.

This is a living document and is subject to change based on community feedback and evolving technological landscapes. We welcome discussion and contributions on all of these items!

## Phase 1 & 2: Solidify the Core & Developer Experience (Near-Term)

This phase is focused on polishing the existing platform and delivering on our "instant time to joy" promise by building out the tools that make Gingee incredibly easy to adopt and use. [COMPLETED]

## Phase 3: Expand Platform Capabilities (Mid-Term)

This phase is focused on adding major new modules that unlock entirely new categories of applications that can be built on Gingee. [INPROGRESS]

-   **Real-Time Communication (`websockets` Module)**
    -   **Goal:** Add first-class support for real-time, bidirectional communication.
    -   **Use Cases:** Live chat applications, real-time notifications, collaborative editing tools, and live data dashboards.
    -   **Implementation:** A new module, likely wrapping a robust library like `ws`, that integrates securely with the Gingee routing model.

-   **Job Queues & Background Processing (`queue` Module)**
    -   **Goal:** Enable applications to offload long-running or deferrable tasks to a background worker process.
    -   **Use Cases:** Sending welcome emails, processing video uploads, generating complex reports, or calling slow third-party APIs without blocking the main request.
    -   **Implementation:** A new `queue` module using a driver-based pattern to support backends like **Redis (via BullMQ)** and a simple in-memory queue for development.

-   **Third-Party Service Adapters**
    -   **Goal:** Transform Gingee into a true integration platform by providing adapters for best-in-class third-party services.
    -   **Modules:**
        -   **`mail`**: For transactional email (with adapters for SendGrid, Amazon SES).
        -   **`storage`**: For cloud object storage (with an adapter for Amazon S3).
        -   **`search`**: For full-text search (with an adapter for Algolia or Elasticsearch).

-   **Social Logins (OAuth 2.0)**
    -   **Goal:** Complete the `auth` module by adding support for "Login with Google/Microsoft/GitHub," etc.
    -   **Implementation:** Integrate **Passport.js** and its rich ecosystem of strategies into the `auth` module, with configuration managed cleanly in `app.json`.

## Phase 4: Production at Scale (Long-Term)

This phase is focused on adding features essential for running massive, high-traffic, enterprise-grade applications.

-   **Clustering & Horizontal Scaling**
    -   **Goal:** Allow a single Gingee instance to run on multiple CPU cores and scale across a fleet of machines.
    -   **Implementation:** Leverage Node.js's `cluster` module and enhance core services (like the app registry and caches) to work in a distributed environment, likely with Redis.

-   **Metrics & Monitoring**
    -   **Goal:** Expose internal server metrics for observability and alerting.
    -   **Implementation:** Add a standard `/metrics` endpoint that exposes data in the **Prometheus** format for easy integration with tools like Grafana.

-   **Community Plugin System**
    -   **Goal:** Allow the community to build, publish, and share their own Gingee app modules.
    -   **Implementation:** Formalize the module system to allow apps to specify third-party modules from NPM in their `app.json`, with careful consideration for security and sandboxing.

## How to Contribute

Gingee is a community-driven project. The best way to get involved is to check out our **GitHub Issues** and **GitHub Discussions**. We welcome bug reports, feature requests, and pull requests!

Please see our [`CONTRIBUTING`](./docs/CONTRIBUTING.html) guide for more details on how to contribute.
