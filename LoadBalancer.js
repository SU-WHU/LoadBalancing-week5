import * as http from "http"
import crypto from "crypto"

import ServerFactory from "./ServerFactory.js"
import Utils from "./Util.js"
import HealthChecker from "./HealthChecker.js"
import FaultInjector from "./FaultInjector.js"
import RateLimiter from "./RateLimiter.js"
// import RoundRobin from "./RoundRobin.js"
// import LeastConnections from "./LeastConnections.js"
// import ConsistentHashing from "./ConsistentHashing.js"

const host = '127.0.0.1'
const port = 8080

var configuration = undefined
var serverFactory = undefined
var loadBalancingAlgorithm = undefined
var healthChecker = undefined
var faultInjector = undefined
var rateLimiter = undefined


export default class LoadBalancer {

    constructor(configuration_) {
        configuration = configuration_

        if (Utils.getAlgorithm(configuration.LoadBalancingAlgorithm) === Utils.Algorithm.RoundRobin) {
            loadBalancingAlgorithm = new RoundRobin(configuration.NoServers)
        }
        else if (Utils.getAlgorithm(configuration.LoadBalancingAlgorithm)  === Utils.Algorithm.LeastConnections) {
            loadBalancingAlgorithm = new LeastConnections()
        }
        else if (Utils.getAlgorithm(configuration.LoadBalancingAlgorithm)  === Utils.Algorithm.ConsistentHashing) {
            loadBalancingAlgorithm = new ConsistentHashing(configuration.NoServers, configuration.Replicas)
        }

        rateLimiter = new RateLimiter(configuration)

        let httpserver = http.createServer(
            async function (req, res) {
                res.setHeader("Content-Type", "application/json");
                switch (req.url) {
                    case "/":
                        res.writeHead(200);
                        res.end(`LoadBalancer is running on http://${host}:${port}/\n\nTo make a session request - http://${host}:${port}/[request]`);
                        break
                    default: {
                        const parsedUrl = new URL(req.url, `http://${host}:${port}`)
                        const sizeParam = parsedUrl.searchParams.get('size')
                        const requestSize = sizeParam !== null ? Number(sizeParam) : undefined

                        // Defences against abusive traffic (disable for the no-defence baseline).
                        if (configuration.Defences?.enabled) {
                            const ip = req.socket.remoteAddress ?? 'unknown'
                            if (!rateLimiter.isAllowed(ip)) {
                                res.writeHead(429);
                                res.end(`Session ACCESS DENIED - rate limit exceeded`);
                                break;
                            }
                            if (requestSize !== undefined && requestSize > configuration.Defences.maxPayloadSize) {
                                res.writeHead(413);
                                res.end(`Session ACCESS DENIED - payload size ${requestSize} exceeds limit ${configuration.Defences.maxPayloadSize}`);
                                break;
                            }
                        }

                        let serverindex = loadBalancingAlgorithm.getNext(req.url)
                        if (serverindex === undefined) {
                            res.writeHead(503);
                            res.end(`Session ACCESS DENIED - no healthy server available`);
                            break;
                        }
                        let nextInLineServer = serverFactory.getServerName(serverindex)

                        const backendPath = sizeParam !== null ? `/start?size=${sizeParam}` : '/start'
                        //route load to next legitimate server, failing fast if it is down or too slow
                        const backendReq = http.get(`${nextInLineServer}${backendPath}`, resp => {
                            let data = ''
                            resp.on('data', chunk => {
                                data += chunk
                            })
                            resp.on('end', () => {
                                res.end(data);
                            })
                            resp.on('error', () => {
                                if (!res.headersSent) {
                                    res.writeHead(503);
                                    res.end(`Session ACCESS DENIED - backend error`);
                                }
                            })
                        })
                        backendReq.on('error', () => {
                            if (!res.headersSent) {
                                res.writeHead(503);
                                res.end(`Session ACCESS DENIED - backend unreachable`);
                            }
                        })
                        backendReq.setTimeout(configuration.BackendTimeoutMs ?? 5000, () => {
                            backendReq.destroy()
                            if (!res.headersSent) {
                                res.writeHead(504);
                                res.end(`Session ACCESS DENIED - backend timeout`);
                            }
                        })
                        break
                    }
                }
            }
        );
        httpserver.listen(port, host, () => {
            console.log(`LoadBalancer is running on http://${host}:${port}`)

            serverFactory = new ServerFactory()
            serverFactory.createServers(configuration)

            healthChecker = new HealthChecker(serverFactory, configuration)
            healthChecker.start()
            faultInjector = new FaultInjector(serverFactory, configuration)
            faultInjector.start()
        });

    }
}


class LeastConnections {
    constructor() {
        this.next = -1
    }

    getNext() {
        this.next = serverFactory.getServerWithMinConnectionsIndex()
        return this.next
    }
}

class RoundRobin {
    constructor(max) {
        this.next = -1
        this.max = max
    }

    getNext() {
        for (let i = 0; i < this.max; i++) {
            this.next = this.next + 1
            if (this.next >= this.max) {
                this.next = 0
            }
            const name = `S${this.next}`
            if (serverFactory.isServerHealthy(name)) {
                return name
            }
        }
        return undefined
    }
}

class ConsistentHashing {
    constructor(noservers_, replicas_) {
        this.noservers = noservers_
        this.replicas = replicas_
        this.hashmap = new Map()
      
        for (let i = 0; i < this.replicas; i++) {// replica
            for (let j = 0; j < this.noservers; j++) {

                let server_hash = crypto.createHash('md5').update(`__S${j}${i}`).digest('hex');
                this.hashmap.set(`__S${j}${i}`,server_hash)
            }
        }
    }

    addClient(requestid){
        if(!this.hashmap.has(requestid)){
            let request_hash = crypto.createHash('md5').update(requestid).digest('hex');
            this.hashmap.set(requestid,request_hash)
        }        
    }

    removeNode(nodeid){
        this.hashmap.delete(nodeid)
    }

    getNext(requestid){
        this.addClient(requestid)

        let serverid = undefined
        //sort by hashkeys
        const hashmap_sorted = new Map([...this.hashmap.entries()].sort((a, b) => a[1].localeCompare(b[1])));

        let rfound = false
        for (let [key, value] of hashmap_sorted) {
            if(key === requestid){
                rfound = true
            }

            if(rfound){
                if(key.startsWith("__S")){
                    let candidate = removeN(key,2)
                    if(this.noservers < 10){
                        candidate = candidate.substring(0, 2);
                    }
                    else if(this.noservers <100){
                        candidate = candidate.substring(0, 3);
                    }
                    else if(this.noservers <1000){
                        candidate = candidate.substring(0, 4);
                    }//max of 999 servers

                    // Skip unhealthy servers and keep walking the ring.
                    if (serverFactory.isServerHealthy(candidate)) {
                        serverid = candidate
                        break
                    }
                }
            }
        }

        return serverid
    }

}

//util functions
const removeN = (str, num) => {
    const { length } = str;
    if(num > length){
       return str;
    };
    const newStr = str.substr(num, length - num);
    return newStr;
 };


