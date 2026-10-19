# Task A

## Team Memebers: Ziyu Su 2810330   Xiyue Zhang 2823696

## Configuration

The configuration we use is as follow:

 ```javascript
  config = {
         LoadBalancingAlgorithm: Utils.AlgorithmStr[1],
         NoServers: 10,
         Replicas: 3,
         MaxNoSessionsPerServer: 100,
         MinNoSessionsPerServer: 30,
         MaxProcessingTime: 30, //30 milliseconds
         MinProcessingTime: 2, //2 milliseconds
         NoDatastores: 2,
         MaxDatastoreSpace: 1073741824, //1GB
         MinDatastoreSpace: 1048576, //100MB
         MaxSizeRequestPayload: 100, //100KB
         MinSizeRequestPayload: 10, //10KB
     }
 ```

## Result

The results are stored in .csv files. File name is as the format yyyy/mm/dd T exact time - the amount.csv

## Conclusion

This configuration performs greatly under low amount of requirement and long time period. However, due to low session per server and long processing time, when the time period become short, the sessions in the  server cannot afford the amount of requirement and then result in timeouts and denied. While the amount becomes more, the same situation will happen as well. The success rate will decrease.

# Task B

## Configuration

Two features are added on top of the Task A configuration: fault tolerance
(health checks + fault injection) and defences against abusive traffic.

 ```javascript
 FaultInjection: { enabled: <bool>, serverId: "S0", failAfterMs: 10000, downDurationMs: 8000 },
 HealthCheck: { intervalMs: 1000 },
 BackendTimeoutMs: 5000,
 Defences: { enabled: <bool>, maxPayloadSize: 100, rateLimitWindowMs: 1000, rateLimitMaxRequests: 100 },
 ```

- **Fault tolerance** — `FaultInjector` takes one server down after
  `failAfterMs` and restores it after `downDurationMs`; `HealthChecker` probes
  `/health` every `intervalMs` and keeps the routing view in sync.
- **Defences** — reject a `?size=` payload over `maxPayloadSize` (HTTP 413),
  limit each client IP to `rateLimitMaxRequests` per `rateLimitWindowMs`
  (HTTP 429), and abort a stuck backend call after `BackendTimeoutMs` (HTTP 504).

## Result

Each feature is measured by an A/B run — the same workload once with the feature
on and once with it off. Full numbers are in `TASK_B_ANALYSIS.md`.

- **Fault tolerance**: with the fault injected, the success rate drops only
  during the 8 s outage (~12 percentage points) and fully recovers afterwards;
  no timeouts and no "no healthy server" 503 occur.
- **Defences**: legitimate traffic stays 50/50 served at ~2 ms latency.
  Oversized payloads go from 20/20 accepted to 20/20 rejected (413); the
  500-request burst goes from 432 backend denials to 470 edge rejections (429).

## Conclusion

The load balancer stays available when a backend fails, removing it from rotation
within about one second and restoring it on recovery. The defences stop abusive
traffic at the edge (413 for oversized payloads, 429 for floods) without
affecting legitimate requests.
