"""FastAPI router for Component 2 risk assessments."""
from __future__ import annotations
from pathlib import Path
from typing import Any
import sys
from fastapi import APIRouter, HTTPException, Path as ApiPath
from pydantic import BaseModel, Field

# This backend component directory is intentionally named with hyphens. Add its
# root to the import path so the service remains importable when run standalone.
COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))
from services.risk_service import RiskService
from blockchain.web3_service import RiskRegistryClient
from integrations.traceability_client import BatchNotFoundError, TraceabilityClient

router = APIRouter(prefix="/api/v1/risk", tags=["medicine-risk"])

class MedicineRequest(BaseModel):
    batch_id: str = Field(min_length=1)
    Name: str
    Category: str
    Dosage_Form: str = Field(alias="Dosage Form")
    Strength: str
    Manufacturer: str
    Indication: str
    Classification: str

    model_config = {"populate_by_name": True}


class TransactionRequest(MedicineRequest):
    sender: str = Field(min_length=1)

@router.post("/assess")
def assess_medicine(payload: MedicineRequest) -> dict[str, Any]:
    try:
        return RiskService().assess(payload.model_dump(by_alias=True))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/assess/batch/{batch_id}")
def assess_registered_batch(
    batch_id: str = ApiPath(min_length=1),
) -> dict[str, Any]:
    """Read a registered Component 1 batch and assess it with Component 2."""
    try:
        medicine = TraceabilityClient().get_risk_payload(batch_id)
        return RiskService().assess(medicine)
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/assess/transaction")
def build_assessment_transaction(payload: TransactionRequest) -> dict[str, Any]:
    """Assess a batch and build an unsigned registry transaction for a wallet."""
    medicine = payload.model_dump(by_alias=True, exclude={"sender"})
    try:
        assessment = RiskService().assess(medicine)
        transaction = RiskRegistryClient().build_record_transaction(
            batch_id=payload.batch_id,
            risk_score=assessment["risk_score"],
            sender=payload.sender,
        )
        return {"assessment": assessment, "transaction": transaction}
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
