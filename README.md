# System Design: Load Balancing Testbed
This is an implementation of a testbed for validating and optimizing load balancing in a system architectural design.

## Configuration

Configuration is currently defined in `MainTerminal.js`. Start the program with:

```sh
node MainTerminal.js
```

The console displays the current configuration and lets you change its values before choosing `Y` to start the load balancer. Changes apply only to the current run; they are not saved when the program exits.

After you choose `Y`, the program prints a startup message for the load balancer, followed by one entry for each backend server it creates. Backend ports and server limits are selected at runtime, so their values can differ between runs. The output is similar to:

```text
LoadBalancer is running on http://127.0.0.1:8080
Server {
  name: 'http://127.0.0.1:<port>',
  id: 'S0',
  maxSessions: <value>,
  processTime: <value>,
  sessions: []
}
```

It then periodically prints status objects for the servers (`id`, `Server`, `MaxSessions`, `processTime`, `Active`, and `limitReached`) and datastores (`id`, `Name`, `MaxStorage`, and `StorageLeft`). These values change as requests are handled. The current implementation schedules a status-printing timer for each backend server, so the full status output may repeat multiple times per interval. The program keeps running to serve requests; stop it with `Ctrl+C`.

The configuration has the following shape:

 ```yaml
 config = {
        LoadBalancingAlgorithm: <value>,
        NoServers: <value>,
        Replicas: <value>,
        MaxNoSessionsPerServer: <value>,
        MinNoSessionsPerServer: <value>,
        MaxProcessingTime: <value>, //seconds
        MinProcessingTime: <value>, //seconds
        NoDatastores: <value>,
        MaxDatastoreSpace: <value>, //GB
        MinDatastoreSpace: <value>, //MB
        MaxSizeRequestPayload: <value>, //MB
        MinSizeRequestPayload: <value>, //MB
    }
```

The testbed evaluates three load-balancing algorithms. These are `Round Robin`, `Least Connections` and `Consistent Hashing`. Given an configuration instance, the aim is to verify the limits of the system in its ability to be highly-available, resilient and to withstand a denial of service attack. 

The effectiveness of a configuration is measured by the frequency of server denial of access either due to lack of servers to handle new sessions or not enough space in the datastore to handle user request payload.

## Fault Tolerance (Task B1)

- `HealthChecker.js` probes each backend server's `/health` endpoint every `HealthCheck.intervalMs` and updates its `healthy` flag (the routing view). Transitions are logged as `[HEALTH] <server> UP/DOWN @ <ms>`.
- `FaultInjector.js` simulates a backend crash/recovery: after `FaultInjection.failAfterMs` it marks one server `failed` (the `/health` endpoint then returns 503), and after `FaultInjection.downDurationMs` it restores it. Logged as `[FAULT] <server> DOWN/UP`.
- The load balancer only routes to healthy servers (Round Robin / Least Connections / Consistent Hashing all skip unhealthy ones). If none are healthy it returns HTTP 503; a failed or slow backend call is answered with 503 (error) or 504 (timeout, `BackendTimeoutMs`).

Run `node MainTerminal.js` and choose `Y`, then in another terminal run `node RequestSimulation.js`. Compare a run with `FaultInjection.enabled: true` against one with `false` to measure lost requests and recovery time.

## Defences Against Abusive Traffic (Task B2)

See `THREAT_MODEL.md` for the threat model. Defences are gated by `Defences.enabled` and implemented in `LoadBalancer.js`:

- **Request-size limit** — `Defences.maxPayloadSize` rejects a client-supplied `?size=` over the limit with HTTP 413.
- **Rate limiting** — `RateLimiter.js` enforces `Defences.rateLimitMaxRequests` per `Defences.rateLimitWindowMs` per client IP, answering HTTP 429.
- **Backend timeout** — `BackendTimeoutMs` aborts a stuck backend call with HTTP 504.

A client can pass its payload size as `GET /request?size=<bytes>`; otherwise the server uses a random payload size as before.

Run the mixed workload with `node AbuseSimulation.js [legitCount] [oversizeCount] [burstCount] [oversizeSize]`, once with `Defences.enabled: true` and once with `false`, to compare legitimate-served and abusive-rejected rates.