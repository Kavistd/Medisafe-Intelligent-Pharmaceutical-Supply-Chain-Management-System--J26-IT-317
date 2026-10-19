# Component 1 measured local evaluation

Replicas: 10; successful measured transactions: 160; rule checks: 330.

| Method | n | Gas median | Gas min–max | Prepare median ms | Broadcast→receipt median ms | End-to-end median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| registerBatch | 30 | 535623 | 535623–535623 | 43.199 | 21.423 | 110.969 |
| initiateTransfer | 60 | 140034 | 131453–148553 | 43.334 | 21.327 | 102.555 |
| cancelTransfer | 40 | 39523 | 39523–39569 | 47.354 | 16.376 | 110.013 |
| confirmTransfer | 20 | 166692 | 158167–175217 | 41.929 | 17.543 | 111.863 |
| recallBatch | 10 | 35097 | 35097–35097 | 34.578 | 18.005 | 86.563 |

Scenario enforcement: 330/330 (100.00%).

This is fixture rule-conformance, not counterfeit-detection accuracy, a security proof, throughput, public-chain latency or IPFS performance. See the evaluation README for definitions, exclusions and limitations. Full distributions and provenance are in results.json; each confirmed transaction is in transactions.csv.
