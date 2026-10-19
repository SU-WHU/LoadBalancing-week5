// Fixed sliding-window rate limiter keyed by client IP address.
// Configure via configuration.Defences = { rateLimitWindowMs, rateLimitMaxRequests }.
export default class RateLimiter {
    constructor(configuration) {
        this.windowMs = configuration.Defences?.rateLimitWindowMs ?? 1000
        this.maxRequests = configuration.Defences?.rateLimitMaxRequests ?? 100
        this.buckets = new Map() // ip -> array of request timestamps (ms)
    }

    isAllowed(ip) {
        const now = Date.now()
        let timestamps = this.buckets.get(ip)
        if (!timestamps) {
            timestamps = []
            this.buckets.set(ip, timestamps)
        }
        // Drop timestamps older than the window.
        while (timestamps.length && now - timestamps[0] > this.windowMs) {
            timestamps.shift()
        }
        if (timestamps.length >= this.maxRequests) {
            return false
        }
        timestamps.push(now)
        return true
    }
}
