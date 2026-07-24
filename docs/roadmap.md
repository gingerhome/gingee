# Gingee Roadmap

Gingee has a strong, stable, and feature-rich foundation. Our core focus on security, developer experience, and a modular, multi-database architecture is complete. This document outlines our vision for the future of the platform, detailing the features and enhancements we are planning to build next.

This is a living document and is subject to change based on community feedback and evolving technological landscapes. We welcome discussion and contributions on all of these items!

## Phase 1 & 2: Solidify the Core & Developer Experience (Near-Term)

This phase is focused on polishing the existing platform and delivering on our "instant time to joy" promise by building out the tools that make Gingee incredibly easy to adopt and use. [COMPLETED]

## Phase 3: Expand Platform Capabilities (Mid-Term)

This phase is focused on adding major new modules that unlock entirely new categories of applications that can be built on Gingee. [INPROGRESS]

-   **Real-Time Communication (`websockets` Module)** *(v1 shipped)*
    -   **Done:** Master HTTP upgrade (`ws`), per-app `app.json` handler/auth, `require('websockets')` rooms/broadcast, `websockets` permission, connection limits, metrics, tenant room helpers, sample app **`ginchat`**.
    -   **Later:** Redis fan-out for multi-node, optional isolation bridge, Glade connection admin UI.

-   **CRON Scheduler** *(v1 shipped: declarative `app.json` schedules; server gate `scheduler.enabled` default off)*
    -   **Next:** Redis leader election for multi-node, runtime API / “Run now” in Glade, optional handoff to `queue`.

-   **Job Queues & Background Processing (`queue` Module)**
    -   **Goal:** Enable applications to offload long-running or deferrable tasks to a background worker process.
    -   **Use Cases:** Sending welcome emails, processing video uploads, generating complex reports, or calling slow third-party APIs without blocking the main request.
    -   **Implementation:** A new `queue` module using a driver-based pattern to support backends like **Redis (via BullMQ)** and a simple in-memory queue for development.

-   **Third-Party Service Adapters**
    -   **Goal:** Transform Gingee into a true integration platform by providing adapters for best-in-class third-party services.
    -   **Modules:**
        -   **`email`**: For transactional email (SendGrid + console shipped; Amazon SES and others later).
        -   **`ai`**: Generative AI module (Gemini + mock shipped; **xai/Grok** and others next).
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

-   **Metrics & Monitoring** *(baseline shipped)*
    -   **Done:** Engine `/metrics` Prometheus scrape (localhost-only by default, optional bearer), counters/histograms for scripts, limits rejects, egress denies, scheduler runs; JSONL `audit` for permissions/lifecycle. See `gingee.json` → `metrics` / `audit`.
    -   **Later:** Richer dashboards, distributed metrics under clustering, optional OpenTelemetry.

-   **Process isolation** *(P1 product baseline shipped)*
    -   **Done:** Opt-in workers (IPC), master listen ports, privileged apps in-process, **buffered + SSE** over IPC (incl. AI), **isolation groups** vs solo `apps`, **auto-restart** with backoff/`restart_max`, worker **ai/email** re-init from app config.
    -   **Later:** Scheduler-in-worker, OS resource limits (cgroups/Job Objects), multi-node worker placement.

-   **Community Plugin System**
    -   **Goal:** Allow the community to build, publish, and share their own Gingee app modules.
    -   **Implementation:** Formalize the module system to allow apps to specify third-party modules from NPM in their `app.json`, with careful consideration for security and sandboxing.

## How to Contribute

Gingee is a community-driven project. The best way to get involved is to check out our **GitHub Issues** and **GitHub Discussions**. We welcome bug reports, feature requests, and pull requests!

Please see our [`CONTRIBUTING`](./docs/CONTRIBUTING.html) guide for more details on how to contribute.
