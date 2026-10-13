# Component 1 -> Component 2

Component 1 sends the batch ID plus `Name`, `Category`, `Dosage Form`, `Strength`, `Manufacturer`, `Indication`, and `Classification`. Component 2 returns a 0-1 `risk_score`, its Low/Medium/High band, and feature contributions. Component 1 must not send patient information.
