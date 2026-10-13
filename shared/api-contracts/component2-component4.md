# Component 2 -> Component 4

Component 4 reads the latest Component 2 risk record by medicine batch ID. The authoritative on-chain value is `scoreBps` (0-10,000); divide it by 10,000 to obtain the 0-1 risk score. The explanation hash identifies the off-chain SHAP explanation.
