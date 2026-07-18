# Gingee Threat Model

**Purpose:** State clearly what Gingee’s security model **is designed for**, what it **is not**, and how operators should deploy it.

**Audience:** Server operators, app packagers, security reviewers, and contributors.

**Related:** [Permissions Guide](./permissions-guide.md), [Server Config](./server-config.md) (`limits`, `scheduler`, `box`), [Concepts](./concepts.md).

---

## 1. One-sentence summary

Gingee provides **cooperative multi-app isolation** on a **shared Node.js process**: apps are separated by **path jails, permission whitelists, and admin consent**—not by hardware virtualization or mutually hostile tenant isolation.

---

## 2. Two deployment models (read this first)

| Model | Description | Gingee fit |
| :--- | :--- | :--- |
| **A. Cooperative multi-app** | One org (or trusted partners) runs several apps on one Gingee instance. Apps are first-party, reviewed third-party, or installed only after admin review of package + permissions. | **Intended.** Permissions, BOX/WEB, Glade, and `limits` are built for this. |
| **B. Hostile multi-tenant** | Untrusted parties upload or install apps that may be malicious or compromised. Tenants must not affect each other’s confidentiality, integrity, or availability. | **Not supported as a hard security boundary.** Do not sell or operate Gingee as “shared hosting for arbitrary untrusted code” without process/container isolation **outside** Gingee. |

**Operator rule of thumb:**

- If you would not give an app’s author shell access on the same machine as other apps, **do not** grant them a Gingee app with broad permissions on a shared production process—or isolate that tenant in a **separate OS process / container / VM**.

---

## 3. Assets worth protecting

| Asset | Examples | Typical owner |
| :--- | :--- | :--- |
| **App private code & data** | `box/` scripts, SQLite files, logs, secrets in `app.json` | App + server admin |
| **App public assets** | `web/` static files | App (intentionally public) |
| **Server control plane** | `gingee.json`, `settings/permissions.json`, SSL keys, backups | Server admin |
| **Other apps on the same process** | Sibling `web/<other-app>/` trees | Other apps / admin |
| **Outbound identity & budget** | SendGrid keys, AI API keys, ability to hit internal networks | Org / cloud account |
| **Platform integrity** | Ability to install/delete apps (`platform` module, privileged apps) | Server admin only |
| **Availability** | Shared event loop, memory, FDs, CPU | All tenants on the node |

---

## 4. Trust boundaries

```
                    ┌─────────────────────────────────────┐
                    │         Untrusted network           │
                    │   (browsers, bots, external APIs)   │
                    └─────────────────┬───────────────────┘
                                      │ HTTPS/HTTP
                    ┌─────────────────▼───────────────────┐
                    │     Gingee Node process (one)       │
                    │  ┌──────────┐  ┌──────────┐         │
                    │  │ App A    │  │ App B    │  ...    │
                    │  │ gbox +   │  │ gbox +   │         │
                    │  │ perms    │  │ perms    │         │
                    │  └────┬─────┘  └────┬─────┘         │
                    │       │ shared heap, event loop     │
                    │       │ shared modules/, config     │
                    │  ┌────▼─────────────────────────┐   │
                    │  │ Privileged apps (e.g. Glade) │   │
                    │  │ platform lifecycle           │   │
                    │  └──────────────────────────────┘   │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
         Host filesystem         Databases / Redis        External HTTPS
         (web_root, settings)    (app-configured)         (httpclient, AI, email)
```

**Inside the Node process there is no hard wall between apps**—only software checks (permissions, path resolution, privileged app list).

---

## 5. Actors and intents

| Actor | Intent | Assumed in cooperative model? |
| :--- | :--- | :--- |
| **Server admin** | Configure host, grant permissions, install apps | Trusted |
| **App developer** (first-party) | Ship business logic; may make mistakes | Semi-trusted (bugs, not malice) |
| **App packager / store app** | Distributes `.gin`; may request excessive perms | Review before grant |
| **End user of an app** | Uses HTTP UI/API of one app | Untrusted for input; trusted only within that app’s auth model |
| **External network attacker** | Exploit exposed HTTP, steal data, DoS | Always untrusted |
| **Malicious app author** | Escape isolation, steal other apps’ data, mine crypto, SSRF | **Out of scope** for hard isolation on a shared process |
| **Compromised dependency** | RCE inside process via native module or prototype pollution | Residual supply-chain risk |

---

## 6. What the platform controls (and how)

### 6.1 Strengths (work as designed under model A)

| Control | Mechanism | Limits of control |
| :--- | :--- | :--- |
| **Default deny modules** | `PROTECTED_MODULES` + `grantedPermissions` | Only modules that check permission; not a full OS sandbox |
| **Path jail (`fs`, relative `require`)** | `isPathInside` / `resolveSecurePath` under app BOX/WEB | Must be used consistently; leading `/` vs script-relative paths can confuse authors |
| **BOX not web-served** | Engine blocks `…/box` URLs | Misconfigured reverse proxies could still expose disk if mounted elsewhere |
| **Privileged apps** | `privileged_apps` + restricted `platform` / engine modules | Anyone who can edit `gingee.json` is root-equivalent for the platform |
| **Permission consent** | `pmft.json` + Glade / CLI + `settings/permissions.json` | Human factor; over-grant is common under time pressure |
| **Request / outbound limits** | `limits` (concurrency, timeouts) | Mitigates accidental DoS and hung I/O; does **not** stop hostile CPU spin |
| **Scheduler gate** | `scheduler.enabled` default off; one-node ops model | Prevents multi-node double-fire; does not prove job code is safe |
| **Explicit high-risk capabilities** | `httpclient`, `email`, `ai`, `scheduler`, `platform` | Once granted, full capability within that API |

### 6.2 Soft sandbox reality (`gbox`)

App scripts run via a custom `require` and `new Function(...)` (not a separate OS process, not `isolated-vm` by default).

**Shared across all apps on the instance:**

- Memory heap and V8 isolates (single process)
- Event loop (one blocked script delays others)
- Ability to allocate until OOM
- Engine modules loaded into the same process

**Therefore:**

| Claim | Valid? |
| :--- | :--- |
| “App A cannot `require('fs')` Node core without grant” | **Yes** (gRequire deny) |
| “App A cannot read App B’s BOX via normal `fs` APIs” | **Yes**, if path jail holds |
| “App A cannot affect App B’s availability” | **No** — CPU/memory/event loop are shared |
| “App A cannot inspect App B’s secrets in RAM” | **No hard guarantee** against sophisticated process-level attacks |
| “Permissions equal cloud multi-tenant isolation” | **No** |

---

## 7. Threat scenarios

### 7.1 Cooperative multi-app (in scope — mitigated)

| ID | Scenario | Primary mitigations | Residual risk |
| :--- | :--- | :--- | :--- |
| C1 | Accidental path traversal in app code | Sandboxed `fs` + `isPathInside` | Bugs in new modules that skip jail |
| C2 | App requests too many permissions | Admin review of `pmft.json` / Glade | Admin grants “all” for convenience |
| C3 | Hung outbound HTTP | `limits.outbound_timeout_ms`, outbound concurrency | Custom axios options still clamped; other egress paths (AI/email) have their own timeouts |
| C4 | Runaway request volume | `max_concurrent_requests` / per-app caps → 503 | No sophisticated rate limit / WAF |
| C5 | Script never finishes | `request_timeout_ms` / stream idle+hard | Sync infinite loops ignore timers until yield |
| C6 | Install wrong package version | Backups, Glade rollback, review `.gin` | Supply chain of the package itself |
| C7 | Secrets in `app.json` | Filesystem permissions, least privilege OS user | Backups, logs, package export may copy secrets |

### 7.2 Hostile multi-tenant (out of scope for hard guarantees)

| ID | Scenario | Why Gingee alone is insufficient |
| :--- | :--- | :--- |
| H1 | Malicious app with only “safe” permissions burns CPU | Shared event loop; no preemption of tight loops |
| H2 | Malicious app with `httpclient` SSRFs cloud metadata / internal APIs | No egress allowlist / private-IP block in platform |
| H3 | Malicious app with `fs` + clever bugs tries cross-app read | Path jail is software; hostile code + engine bugs = higher risk |
| H4 | Malicious app with `platform` (if wrongly privileged) | Full lifecycle control of all apps |
| H5 | Malicious app with `scheduler` + `httpclient` | Persistent unattended egress |
| H6 | Tenant escapes to steal other apps’ DB credentials from config in memory | Single process; no crypto boundary between apps |
| H7 | Resource exhaustion (FD/memory) | `limits` help for HTTP concurrency; not a full cgroup story |

**Required pattern for hostile or untrusted code:** **one Gingee process (or container) per trust domain**, network policy, secrets isolation, and independent resource limits at the orchestrator level.

---

## 8. STRIDE-style view (platform level)

| Category | Example | Cooperative posture |
| :--- | :--- | :--- |
| **S**poofing | Forged admin session on Glade | App-level auth (JWT etc.); harden Glade credentials; TLS |
| **T**ampering | Modified `permissions.json` on disk | OS file permissions; restrict who can write `settings/` |
| **R**epudiation | “Who granted `httpclient`?” | Ops logging / future audit trail; today: file history + process logs |
| **I**nformation disclosure | App data leakage via another app | Path jail + no cross-app API by default; not RAM isolation |
| **D**enial of service | Heavy PDF/AI script stalls node | `limits`, separate processes for heavy apps, timeouts |
| **E**levation of privilege | Normal app becomes privileged | Keep `privileged_apps` minimal; never put untrusted apps there |

---

## 9. Data flow trust notes

| Flow | Trust note |
| :--- | :--- |
| Browser → App HTTP script | Validate all input in the app; Gingee parses body with size caps (`max_body_size`) |
| App → `db` | Credentials from `app.json`; compromise of app with `db` = data plane compromise for that DB |
| App → `httpclient` / AI / email | Treat as full egress for that capability; prefer dedicated keys with least privilege at the provider |
| App → `fs` BOX | Private to app path; still on shared disk volume |
| Admin → Glade/`platform` | Highest privilege path; protect like root |
| Scheduler → script/URL | Runs as that app’s permissions; enable only on intended node |

---

## 10. Operator checklist

### Recommended for production (cooperative multi-app)

1. Run Gingee as a **non-root** OS user with write access only to intended dirs (`web/`, `settings/`, `logs/`, `backups/`, `temp/`).
2. Keep **`privileged_apps`** to Glade (or equivalent) only.
3. Grant permissions **least privilege**; prefer optional over mandatory in packages you publish.
4. Set **`limits`** appropriately; do not disable timeouts without a reason.
5. Keep **`scheduler.enabled`** false except on the designated scheduler node.
6. Prefer **Redis** for cache when running more than one node.
7. Put TLS at reverse proxy or Gingee HTTPS; do not expose Glade to the public internet without strong auth and network restriction.
8. Treat **`app.json` secrets** as sensitive; restrict backups and who can download `.gin` exports.
9. Leave **`box.allowed_modules`** empty unless you fully understand the escape hatch.
10. Review every new `.gin`’s `pmft.json` before production grant.

### Required if any app is untrusted (hostile model)

1. **Do not** co-locate untrusted apps in the same Node process as sensitive apps.
2. Use **containers/VMs** per tenant (or per trust domain) with CPU/memory/network quotas.
3. Apply **egress network policy** (block link-local / metadata IPs).
4. Use **separate** DB credentials, AI keys, and email keys per tenant.
5. Assume **compromise of one tenant process = full control of that process only**, not “Gingee permission sandboxes will save you.”

---

## 11. Developer checklist (app authors)

1. Declare only permissions you need in `pmft.json`.
2. Handle missing **optional** permissions gracefully.
3. Use **leading `/`** on `fs` paths when multiple scripts must share BOX-root files (scheduled jobs vs HTTP handlers).
4. Do not store long-lived secrets in client-visible responses.
5. Respect `$g.request.signal` / timeouts for long work; design heavy jobs for scheduler or future queues.
6. Never assume another app’s BOX or server `settings/` is readable.

---

## 12. Explicit non-goals (current platform)

Gingee does **not** currently claim:

- Process- or VM-level isolation between apps on one instance  
- Formal verification of the sandbox  
- Built-in WAF, CSRF framework, or global end-user SSO  
- SSRF-safe HTTP by default  
- Multi-tenant billing isolation or noisy-neighbor SLAs  
- Guaranteed preemption of malicious infinite loops  

These may appear on the roadmap (workers, queues, metrics, cluster); until shipped and documented, treat them as **absent**.

---

## 13. Mapping to critical assessment P0

| Assessment item | This document |
| :--- | :--- |
| Document cooperative vs hostile models | §§2, 7, 10 |
| Stop false assumptions about sandbox | §§6.2, 7.2, 12 |
| Align operators with real controls | §§6.1, 10 |
| Residual risk honesty | Throughout |

**Related P0 (implemented separately):** request/outbound timeouts and concurrency — see `limits` in [Server Config](./server-config.md). That reduces **availability** abuse under cooperative load; it is not a substitute for tenant isolation.

---

## 14. Document control

| Field | Value |
| :--- | :--- |
| Status | Living document |
| Source of truth for permissions keys | [Permissions Guide](./permissions-guide.md) + `modules/platform.js` `ALL_PERMISSIONS` |
| Implementation anchors | `modules/gbox.js`, `modules/fs.js`, `modules/limits.js`, `modules/scheduler.js`, `gingee.js` |

When changing isolation guarantees (e.g. worker-per-app), **update this document in the same PR** so the threat model never lies.
