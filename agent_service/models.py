from pydantic import BaseModel, Field

class TransactionEvidence(BaseModel):
    id: str
    ts: str
    sender: str
    receiver: str
    amount: float
    currency: str
    rail: str
    source_bank: str
    dest_bank: str
    status: str

class InvestigationInput(BaseModel):
    case_title: str = Field(max_length=240)
    severity: str
    detector_reasons: list[str] = Field(max_length=20)
    rule_ids: list[str] = Field(max_length=20)
    observed_transactions: list[TransactionEvidence] = Field(min_length=1, max_length=250)

class SpecialistNotes(BaseModel):
    observations: list[str] = Field(min_length=1, max_length=8)
    caveats: list[str] = Field(max_length=8)
    referenced_transaction_ids: list[str] = Field(max_length=250)

class EvidenceCheck(BaseModel):
    supported_transaction_ids: list[str] = Field(max_length=250)
    unsupported_claims: list[str] = Field(max_length=8)
    missing_context: list[str] = Field(max_length=8)

class CoordinatorReport(BaseModel):
    summary: str
    why_suspicious: list[str] = Field(min_length=1, max_length=8)
    benign_explanations: list[str] = Field(min_length=1, max_length=8)
    next_steps: list[str] = Field(min_length=1, max_length=8)
    confidence: str
    evidence_gaps: list[str] = Field(max_length=8)
