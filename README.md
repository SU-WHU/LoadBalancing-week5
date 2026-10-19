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