# Threat Model — Load Balancing Testbed (Task B2)

Scope: the local testbed (`LoadBalancer` → `ServerFactory` → `Server` → `DatabaseFactory`). Traffic is simulated locally; no external systems are targeted.

## Assets

| Asset | Resource at risk | Failure mode |
|---|---|---|
| Server session capacity | `Server.maxSessions` (per-server session slots) | Slots exhausted → `ACCESS DENIED - No server available` |
| Datastore storage | `Database.storageleft` (only decreases, never reclaimed) | Storage exhausted → `ACCESS DENIED - not available in datastore` |
| Network / sockets | Load balancer ↔ backend connections | Slow/hung requests tie up sockets |
| Load balancer availability | The single LB on :8080 | Flooded with more requests than it can route |

## Attack paths

| # | Attack | Vector | Resource at risk | Likelihood | Impact |
|---|---|---|---|---|---|
| A1 | Volumetric flood | Many requests per second (burst) | Sessions, datastore, LB sockets | High | High — DoS once capacity is exhausted |
| A2 | Oversized payload | Request carries a huge `?size=` value | Datastore (drained by one request) | High | High — datastore fills after a few requests |
| A3 | Slow / hanging requests | Requests that hold a connection open | Sockets on LB and backend | Medium | Medium — socket exhaustion / delayed responses |

## Defences (implemented)

| Defence | Where | Behaviour | Attack mitigated |
|---|---|---|---|
| Request-size limit | `LoadBalancer.js` (config `Defences.maxPayloadSize`) | Rejects `?size=` above the limit with HTTP 413 | A2 |
| Rate limiting | `RateLimiter.js` (per-IP sliding window) | Rejects requests over `rateLimitMaxRequests` per `rateLimitWindowMs` with HTTP 429 | A1 |
| Backend timeout | `LoadBalancer.js` (`BackendTimeoutMs`) | Aborts a backend call that exceeds the timeout with HTTP 504 | A3 |
| Health checks + fault tolerance | `HealthChecker.js` / `FaultInjector.js` | Removes unhealthy servers from rotation, restores on recovery | Availability (A1 impact) |

Defences are gated by `configuration.Defences.enabled` so the same workload can be run with and without them for comparison.

## Trade-offs (for evaluation)

- **Rate limiting** adds a per-request check (timestamp bookkeeping per IP) and can reject legitimate bursts once the window is full.
- **Size limit** protects the datastore but rejects any legitimate request carrying an oversized payload.
- **Backend timeout** protects sockets but may abort slow-but-legitimate requests.

## Test approach

Run `node AbuseSimulation.js` twice — once with `Defences.enabled = true`, once with `false` — and compare:
- legitimate requests served,
- abusive requests rejected (413 / 429),
- latency impact on legitimate requests.
