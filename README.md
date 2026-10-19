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