import * as http from "http"
import Server from "./Server.js"
import DatabaseFactory from "./DatabaseFactory.js"
import Utils from "./Util.js"

const host = '127.0.0.1'
var configuration = undefined

export default class ServerFactory {

    constructor() {
        this.servers = new Map()
    }

    getServers() {
        return this.servers
    }
    getServerName(index){
        return this.servers.get(`${index}`).name
    }

    isServerHealthy(name){
        const server = this.servers.get(name)
        return server ? server.isHealthy() : false
    }

    getHealthyServers(){
        return [...this.servers.values()].filter(server => server.isHealthy())
    }

    getServerWithMinConnectionsIndex(){
        let minkey = undefined
        let minsessions = Infinity

        for (let [key, server] of this.servers) {
            if (!server.isHealthy()) continue
            if (server.getNoSessions() < minsessions){
                minkey = key
                minsessions = server.getNoSessions()
            }
        }
        return minkey
    }

    async createServers(configuration_) {
        configuration = configuration_
        DatabaseFactory.createDatabases(configuration)

        for (let i = 0; i < configuration.NoServers; i++) {
            let port
            let server

            let maxSessions = Utils.getRandomInt(configuration.MinNoSessionsPerServer, configuration.MaxNoSessionsPerServer)
            let processTime = Utils.getRandomInt(configuration.MinProcessingTime, configuration.MaxProcessingTime) 

            let httpserver = http.createServer(
                async function (req, res) {
                    res.setHeader("Content-Type", "application/json");
                    switch (req.url) {
                        case "/":
                            res.writeHead(200);
                            res.end(`Server ${i} is running on http://${host}:${port}`);
                            break
                        case "/health":
                            if (!server.isFailed()) {
                                res.writeHead(200);
                                res.end(JSON.stringify({ status: "UP" }));
                            } else {
                                res.writeHead(503);
                                res.end(JSON.stringify({ status: "DOWN" }));
                            }
                            break
                        default:
                            if (server.isFailed()) {
                                res.writeHead(503);
                                res.end(`Session ACCESS DENIED on http://${host}:${port} - server unavailable`);
                                break;
                            }
                            res.writeHead(200);

                            // Use the client-supplied payload size when present (for size-limit defence tests).
                            const sizeParam = new URL(req.url, `http://${host}:${port}`).searchParams.get('size')
                            let requestPayloadRange = sizeParam !== null
                                ? Number(sizeParam)
                                : Utils.getRandomInt(configuration.MinSizeRequestPayload, configuration.MaxSizeRequestPayload) //random payload if not supplied
                            let saved = await  DatabaseFactory.savePayloadToDatastore(requestPayloadRange)
                            if(saved){
                                let ip = req.connection.remoteAddress
                                let success = await server.addSession(ip)
                                if (success) {
                                    res.end(`Session ACCESS GRANTED on http://${host}:${port}`);
                                }
                                else {
                                    res.end(`Session ACCESS DENIED on http://${host}:${port} - No server available`);
                                }
                            }
                            else{
                                res.end(`Session ACCESS DENIED on http://${host}:${port} - request space of ${requestPayloadRange}MB is not available in datastore`);
                            }
                            
                            break
                    }

                }
            );
            // Let the OS allocate and bind an available port, avoiding reserved ports.
            await new Promise((resolve, reject) => {
                httpserver.once('error', reject)
                httpserver.listen(0, host, () => {
                    httpserver.removeListener('error', reject)
                    resolve()
                })
            });
            port = httpserver.address().port
            server = new Server(`S${i}`, `http://${host}:${port}`, maxSessions, processTime)
            this.servers.set(`S${i}`, server)
            console.log(server)

            // show servers and database status every 4 seconds
            setInterval(() => {
                this.showServersStatus()
                DatabaseFactory.showDatabasesStatus()
            }, 4000);

        }
    }

    showServersStatus() {
        function review(value, key, map) {
            let serverstatus = value.getStatus()
            console.log(serverstatus)
        }
        this.servers.forEach(review);
    }
}

