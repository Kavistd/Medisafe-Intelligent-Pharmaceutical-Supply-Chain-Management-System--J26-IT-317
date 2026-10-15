# Component 2 -> Component 4

Component 4 reads the latest Component 2 risk record by medicine batch ID. The authoritative on-chain value is `riskScore` on a 0-100 integer scale; divide it by 100 to obtain the model's 0-1 risk score. A batch is marked unsafe when its model score is in the High risk band (`>= 0.70`). SHAP explanations remain off-chain in the Component 2 API response.
