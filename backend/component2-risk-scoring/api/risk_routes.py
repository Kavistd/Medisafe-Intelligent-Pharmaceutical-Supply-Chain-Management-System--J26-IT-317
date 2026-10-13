"""FastAPI router for Component 2 risk assessments."""
from __future__ import annotations
from pathlib import Path
from typing import Any
import sys
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# This backend component directory is intentionally named with hyphens. Add its
# root to the import path so the service remains importable when run standalone.
COMPONENT_ROOT = Path(__file__).resolve().parents[1]
if str(COMPONENT_ROOT) not in sys.path:
    sys.path.insert(0, str(COMPONENT_ROOT))
from services.risk_service import RiskService

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

@router.post("/assess")
def assess_medicine(payload: MedicineRequest) -> dict[str, Any]:
    try:
        return RiskService().assess(payload.model_dump(by_alias=True))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
