import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// 在另一个终端启动 MainTerminal.js 后运行：node RequestSimulation.js
// 可选参数：每档发送时长(ms)、单次请求超时(ms)
// 示例：node RequestSimulation.js 10000 5000
const intervals = [500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 40, 30, 20, 15, 10, 5, 1];
const batchSize = 10;
const durationMs = Number(process.argv[2] ?? 30000);
const timeoutMs = Number(process.argv[3] ?? 35000);

for (const [name, value] of [['durationMs', durationMs], ['timeoutMs', timeoutMs]]) {
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
        console.error(`${name} 必须是 1 到 2147483647 之间的整数。`);
        process.exit(1);
    }
}

// 使用 IPv4，与 LoadBalancer.js 的监听地址保持一致。
const target = 'http://localhost:8080/request';
const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = fileURLToPath(new URL(`RequestSimulation-${timestamp}.csv`, import.meta.url));
const columns = ['intervalMs', 'batchSize', 'sendDurationMs', 'sent', 'success', 'failed',
    'successRatePercent', 'failureRatePercent', 'denied', 'httpErrors',
    'networkErrors', 'timeouts', 'unexpectedResponses', 'actualRequestsPerSecond'];
let stopping = false;
process.on('SIGINT', () => {
    if (!stopping) console.log('\n停止发送，等待已发出的请求完成并保存结果……');
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

            // 不等待上一个请求返回，保证慢响应不会将发送过程串行化。
            const request = http.get(target, { agent, family: 4 }, (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                    // 服务返回短文本；限制缓存，避免意外大响应占用过多内存。
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
            // 总耗时超时，而非仅检测 socket 空闲时间。
            deadline = setTimeout(() => {
                finish('timeouts');
                request.destroy();
            }, timeoutMs);
        }

        // 每次定时触发并发发送一批请求，每条请求单独统计结果。
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
    console.log(`目标：${target}；每档发送 ${durationMs} ms；请求超时 ${timeoutMs} ms。`);
    console.log('成功 = HTTP 2xx 且包含 ACCESS GRANTED；其他结果均计为失败。');
    console.log('各档连续运行，服务器和数据库状态会延续；毫秒定时受事件循环精度影响。');
    console.log(`结果文件：${outputPath}`);
    try {
        for (const intervalMs of intervals) {
            if (stopping) break;
            console.log(`\n开始：每 ${intervalMs} ms 并发发送 ${batchSize} 条请求……`);
            const result = await runStage(intervalMs);
            appendFileSync(outputPath, `${columns.map((key) => result[key]).join(',')}\n`, 'utf8');
            console.table([result]);
        }
    } finally {
        agent.destroy();
    }
    console.log(`\n统计已保存：${outputPath}`);
}

main().catch((error) => {
    console.error('模拟失败：', error.message);
    process.exitCode = 1;
});
