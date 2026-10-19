import http from 'node:http';
import { performance } from 'node:perf_hooks';

// Start MainTerminal.js in another terminal, then run: node AbuseSimulation.js
// Sends a controlled mix of legitimate and abusive traffic to the load balancer
// so the effect of the defences (size limit, rate limit) can be measured.
// Optional arguments: legitCount, oversizeCount, burstCount, oversizeSize.
// Example: node AbuseSimulation.js 50 20 500 10000
const legitCount = Number(process.argv[2] ?? 50);       // normal requests (moderate rate)
const oversizeCount = Number(process.argv[3] ?? 20);    // requests with an oversized payload
const burstCount = Number(process.argv[4] ?? 500);      // concurrent burst to trip rate limiting
const oversize = Number(process.argv[5] ?? 10000);      // oversized payload size (bytes)

const target = 'http://localhost:8080/request';
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

function send(query = '') {
    return new Promise((resolve) => {
        const started = performance.now();
        const req = http.get(`${target}${query}`, { agent, family: 4 }, (resp) => {
            let body = '';
            resp.on('data', (chunk) => { body += chunk; });
            resp.on('end', () => {
                resolve({ status: resp.statusCode, body: body.trim(), ms: Number((performance.now() - started).toFixed(1)) });
            });
        });
        req.on('error', (e) => resolve({ status: 0, body: e.message, ms: Number((performance.now() - started).toFixed(1)) }));
        req.setTimeout(10000, () => {
            req.destroy();
            resolve({ status: 0, body: 'timeout', ms: 10000 });
        });
    });
}

function classify(status, body) {
    if (body.includes('rate limit exceeded')) return 'rateLimited(429)';
    if (body.includes('payload size') && body.includes('exceeds limit')) return 'sizeRejected(413)';
    if (body.includes('ACCESS GRANTED')) return 'served';
    if (body.includes('ACCESS DENIED')) return 'denied';
    return `other(${status})`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log(`AbuseSimulation: legit=${legitCount}, oversize=${oversizeCount}, burst=${burstCount}, oversizeSize=${oversize}`);
    console.log(`Target: ${target}`);

    // Phase 1: legitimate traffic at a moderate rate.
    const legit = { served: 0, rejected: 0, totalMs: 0, breakdown: {} };
    for (let i = 0; i < legitCount; i++) {
        const r = await send('');
        const c = classify(r.status, r.body);
        legit.breakdown[c] = (legit.breakdown[c] ?? 0) + 1;
        c === 'served' ? legit.served++ : legit.rejected++;
        legit.totalMs += r.ms;
        await sleep(5); // keep below the rate limit so legit traffic is not throttled
    }

    // Phase 2: oversized payloads, sent one at a time (size limit should reject).
    const oversized = { served: 0, rejected: 0, breakdown: {} };
    for (let i = 0; i < oversizeCount; i++) {
        const r = await send(`?size=${oversize}`);
        const c = classify(r.status, r.body);
        oversized.breakdown[c] = (oversized.breakdown[c] ?? 0) + 1;
        c === 'served' ? oversized.served++ : oversized.rejected++;
    }

    // Phase 3: burst of normal requests (rate limit should reject the excess).
    const burst = { served: 0, rejected: 0, breakdown: {} };
    const results = await Promise.all(Array.from({ length: burstCount }, () => send('')));
    for (const r of results) {
        const c = classify(r.status, r.body);
        burst.breakdown[c] = (burst.breakdown[c] ?? 0) + 1;
        c === 'served' ? burst.served++ : burst.rejected++;
    }

    console.log('\n=== Legitimate (moderate rate) ===');
    console.log(`served: ${legit.served}, rejected: ${legit.rejected}, avg latency: ${(legit.totalMs / legitCount).toFixed(1)}ms`);
    console.log('breakdown:', legit.breakdown);
    console.log('\n=== Oversized payload ===');
    console.log(`served: ${oversized.served}, rejected: ${oversized.rejected}`);
    console.log('breakdown:', oversized.breakdown);
    console.log('\n=== Burst (rate limit) ===');
    console.log(`served: ${burst.served}, rejected: ${burst.rejected}`);
    console.log('breakdown:', burst.breakdown);

    agent.destroy();
}

main().catch((error) => {
    console.error('AbuseSimulation failed:', error.message);
    process.exitCode = 1;
});
