# Component 1 measured local evaluation

Replicas: 10; successful measured transactions: 160; rule checks: 330.

| Method | n | Gas median | Gas min–max | Prepare median ms | Broadcast→receipt median ms | End-to-end median ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| registerBatch | 30 | 535623 | 535623–535623 | 49.528 | 22.438 | 121.869 |
| initiateTransfer | 60 | 140034 | 131453–148553 | 41.275 | 22.419 | 110.713 |
| cancelTransfer | 40 | 39523 | 39523–39569 | 48.399 | 21.416 | 116.980 |
| confirmTransfer | 20 | 166692 | 158167–175217 | 48.378 | 24.993 | 128.912 |
| recallBatch | 10 | 35097 | 35097–35097 | 35.970 | 23.301 | 100.711 |

Scenario enforcement: 330/330 (100.00%).

This is fixture rule-conformance, not counterfeit-detection accuracy, a security proof, throughput, public-chain latency or IPFS performance. See the evaluation README for definitions, exclusions and limitations. Full distributions and provenance are in results.json; each confirmed transaction is in transactions.csv.
