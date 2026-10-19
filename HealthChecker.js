import http from 'node:http'

// Periodically probes every backend server's /health endpoint and keeps each
// server's healthy flag in sync, logging any transition. The transition log is
// used to measure detection latency and recovery time.
export default class HealthChecker {
    constructor(serverFactory, configuration) {
        this.serverFactory = serverFactory
        this.intervalMs = configuration.HealthCheck?.intervalMs ?? 1000
    }

    start() {
        setInterval(() => this.check(), this.intervalMs)
    }

    check() {
        for (const [name, server] of this.serverFactory.getServers()) {
            const req = http.get(`${server.name}/health`, { timeout: 2000 }, (resp) => {
                this.update(name, server, resp.statusCode === 200)
                resp.resume()
            })
            req.on('error', () => this.update(name, server, false))
            req.on('timeout', () => {
                req.destroy()
                this.update(name, server, false)
            })
        }
    }

    update(name, server, healthy) {
        if (server.isHealthy() !== healthy) {
            server.setHealthy(healthy)
            console.log(`[HEALTH] ${name} ${healthy ? 'UP' : 'DOWN'} @ ${Date.now()}`)
        }
    }
}
