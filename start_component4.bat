@echo off
TITLE MediSafe Chain - Component 4 Standalone Runner
color 0A

echo =====================================================================
echo           MEDISAFE CHAIN - COMPONENT 4 STANDALONE RUNNER
echo      Privacy-Preserving Blockchain Prescription Management System
echo           Author: R.A.M.A. Ranasinghe (IT23142978)
echo =====================================================================
echo.
echo [1/3] Starting Hardhat Local Blockchain Node (Port 8545, Chain 31337)...
start "MediSafe - Hardhat Node" cmd /k "cd blockchain && npx hardhat node"

echo Waiting 5 seconds for Hardhat node to initialize...
timeout /t 5 /nobreak >nul

echo [2/3] Deploying Component 4 Contracts and Seeding Accounts & Data...
cd blockchain
call npx hardhat run ../scripts/setup/setup_component4_demo.js --network localhost
call npx hardhat run ../scripts/seed/seed_component4.js --network localhost
cd ..

echo.
echo [3/3] Starting Component 4 Services...
start "MediSafe - Component 4 Backend (Port 5004)" cmd /k "cd backend\component4-prescription && node server.js"
start "MediSafe - Component 4 Frontend (Port 5173)" cmd /k "cd frontend && npm run dev"

echo Waiting 3 seconds for Vite to launch...
timeout /t 3 /nobreak >nul

echo.
echo =====================================================================
echo   SUCCESS: Component 4 is running standalone!
echo   - Blockchain RPC: http://127.0.0.1:8545 (Chain ID: 31337)
echo   - Backend API:    http://localhost:5004
echo   - Frontend Web:   http://localhost:5173
echo.
echo   Opening browser at http://localhost:5173 ...
echo =====================================================================
start http://localhost:5173

pause
