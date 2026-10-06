# MediSafe Chain

MediSafe Chain is a blockchain-based pharmaceutical supply chain management system that helps keep medicines safe from manufacturer to patient. It is built from four components: (1) medicine traceability, which records each batch's journey on-chain; (2) AI-based risk scoring, which flags suspicious batches using machine learning; (3) pharmacy trust and verification, which rates and verifies pharmacies; and (4) prescription management, which handles prescriptions while protecting patient privacy.

## Folder Structure

- `frontend/` - React web app for all four components.
- `backend/` - API services, one folder per component.
- `blockchain/` - Solidity smart contracts, Hardhat config, deploy scripts and contract tests.
- `ai/` - Data, notebooks, training, explainability and inference for the Component 2 risk model.
- `validation/` - Simulation, sensitivity and AHP validation work for Component 3.
- `shared/` - Schemas, API contracts, constants, contract addresses and ABIs used across components.
- `integration/` - Integration code and tests between components, plus end-to-end tests.
- `docs/` - Architecture, API, blockchain, dataset, testing and research documentation.
- `config/` - Environment-specific configuration (development, testing, production).
- `scripts/` - Setup, seed and utility scripts for the project.
