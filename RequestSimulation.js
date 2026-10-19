import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// Start MainTerminal.js in another terminal, then run: node RequestSimulation.js
// Optional arguments: batch size, sending duration per stage (ms), request timeout (ms).
// Allowed batch sizes: 10, 100, 1000, 10000, 100000. Default: 10.
// Example: node RequestSimulation.js 1000 (1000 requests per batch, 10 seconds per stage).
// Example: node RequestSimulation.js 1000 10000 5000
const intervals = [500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 40, 30, 20, 15, 10, 5, 1];
const allowedBatchSizes = [10, 100, 1000, 10000, 100000];
const batchSize = Number(process.argv[2] ?? 10);
const durationMs = Number(process.argv[3] ?? 10000);
const timeoutMs = Number(process.argv[4] ?? 35000);

if (!allowedBatchSizes.includes(batchSize)) {
    console.error(`Batch size must be one of: ${allowedBatchSizes.join(', ')}.`);
    process.exit(1);
}

for (const [name, value] of [['durationMs', durationMs], ['timeoutMs', timeoutMs]]) {
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
        console.error(`${name} must be an integer between 1 and 2147483647.`);
        process.exit(1);
    }
}

// Use IPv4 to match the listening address in LoadBalancer.js.
const target = 'http://localhost:8080/request';
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
// Include the UTC date and time, followed by the number of requests per batch.
const outputPath = fileURLToPath(new URL(`RequestSimulation-${timestamp}-${batchSize}.csv`, import.meta.url));
const columns = ['intervalMs', 'batchSize', 'sendDurationMs', 'sent', 'success', 'failed',
    'successRatePercent', 'failureRatePercent', 'denied', 'httpErrors',
    'networkErrors', 'timeouts', 'unexpectedResponses', 'actualRequestsPerSecond'];
let stopping = false;
process.on('SIGINT', () => {
    if (!stopping) console.log('\nStopping new requests; waiting for pending requests to finish and saving results...');
    stopping = true;
});

function runStage(intervalMs) {
    return new Promise((resolve) => {
        const counts = { sent: 0, success: 0, denied: 0, httpErrors: 0,
            networkErrors: 0, timeouts: 0, unexpectedResponses: 0 };
        const started = performance.now();
        let sending = true;
        let pending = 0;
        let sendDurationMs = 0;

        function completeStage() {
            if (sending || pending !== 0) return;
            const failed = counts.sent - counts.success;
            const rate = (count) => counts.sent ? Number((100 * count / counts.sent).toFixed(2)) : 0;
            resolve({ intervalMs, batchSize, sendDurationMs: Number(sendDurationMs.toFixed(2)),
                ...counts, failed, successRatePercent: rate(counts.success),
                failureRatePercent: rate(failed),
                actualRequestsPerSecond: Number((counts.sent * 1000 / sendDurationMs).toFixed(2)) });
        }

        function sendRequest() {
            counts.sent++;
            pending++;
            let finished = false;
            let deadline;
            const finish = (result) => {
                if (finished) return;
                finished = true;
                clearTimeout(deadline);
                counts[result]++;
                pending--;
                completeStage();
            };

            // Send requests without waiting for earlier responses to complete.
            const request = http.get(target, { agent, family: 4 }, (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    // Expect short text responses; limit buffering to bound memory usage.
                    if (body.length < 65536) body += chunk.slice(0, 65536 - body.length);
                });
                response.on('end', () => {
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        finish('httpErrors');
                    } else if (body.includes('ACCESS DENIED')) {
                        finish('denied');
                    } else if (body.includes('ACCESS GRANTED')) {
                        finish('success');
                    } else {
                        finish('unexpectedResponses');
                    }
                });
                response.on('aborted', () => finish('networkErrors'));
                response.on('error', () => finish('networkErrors'));
            });
            request.on('error', () => finish('networkErrors'));
            // Enforce a total request deadline, including time when the socket is active.
            deadline = setTimeout(() => {
                finish('timeouts');
                request.destroy();
            }, timeoutMs);
        }

        // Send a concurrent batch on each tick and count each request separately.
        function sendBatch() {
            for (let i = 0; i < batchSize; i++) sendRequest();
        }

        function stopSending() {
            if (!sending) return;
            sending = false;
            clearInterval(timer);
            clearTimeout(endTimer);
            sendDurationMs = performance.now() - started;
            completeStage();
        }

        const timer = setInterval(() => {
            if (stopping || performance.now() - started >= durationMs) stopSending();
            else sendBatch();
        }, intervalMs);
        const endTimer = setTimeout(stopSending, durationMs);
        sendBatch();
    });
}

async function main() {
    writeFileSync(outputPath, `${columns.join(',')}\n`, 'utf8');
    console.log(`Target: ${target}; batch size: ${batchSize}; sending duration per stage: ${durationMs} ms; request timeout: ${timeoutMs} ms.`);
    console.log('Success = HTTP 2xx with ACCESS GRANTED in the response; all other outcomes count as failures.');
    console.log('Stages run consecutively and share server and database state; timer precision depends on the event loop.');
    console.log(`Results file: ${outputPath}`);
    try {
        for (const intervalMs of intervals) {
            if (stopping) break;
            console.log(`\nStarting: send ${batchSize} concurrent requests every ${intervalMs} ms...`);
            const result = await runStage(intervalMs);
            appendFileSync(outputPath, `${columns.map((key) => result[key]).join(',')}\n`, 'utf8');
            console.table([result]);
        }
    } finally {
        agent.destroy();
    }
    console.log(`\nResults saved: ${outputPath}`);
}

main().catch((error) => {
    console.error('Simulation failed:', error.message);
    process.exitCode = 1;
});
