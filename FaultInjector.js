// Simulates a backend server crash and recovery by flipping its healthy flag
// after a delay, keeping it down for a fixed duration, then restoring it.
// Configure via configuration.FaultInjection = { enabled, serverId, failAfterMs, downDurationMs }.
export default class FaultInjector {
    constructor(serverFactory, configuration) {
        this.serverFactory = serverFactory
        this.config = configuration.FaultInjection ?? {}
    }

    start() {
        if (!this.config.enabled) return
        const { failAfterMs = 10000, downDurationMs = 8000 } = this.config

        setTimeout(() => {
            const target = this.pickTarget()
            const server = this.serverFactory.getServers().get(target)
            if (!server) {
                console.log(`[FAULT] target server ${target} not found`)
                return
            }
            server.setFailed(true)
            console.log(`[FAULT] ${target} DOWN @ ${Date.now()}`)
            setTimeout(() => {
                server.setFailed(false)
                console.log(`[FAULT] ${target} UP @ ${Date.now()} (recovered after ${downDurationMs}ms)`)
            }, downDurationMs)
        }, failAfterMs)
    }

    pickTarget() {
        const serverId = this.config.serverId
        if (serverId && serverId !== 'random') {
            return serverId
        }
        const keys = [...this.serverFactory.getServers().keys()]
        return keys[Math.floor(Math.random() * keys.length)]
    }
}
