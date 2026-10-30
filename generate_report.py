import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_header_footer(num_pages)
            super(NumberedCanvas, self).showPage()
        super(NumberedCanvas, self).save()

    def draw_header_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#1A365D"))
        
        # Header (Pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 755, "MEDISAFE CHAIN | SYSTEM RUN, FLOW & PAYLOAD SPECIFICATION")
            self.setFont("Helvetica", 8)
            self.setFillColor(colors.HexColor("#718096"))
            self.drawRightString(558, 755, "RESEARCH PROJECT J26-IT-317")
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.75)
            self.line(54, 747, 558, 747)

        # Footer (All pages)
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#718096"))
        self.drawString(54, 35, "CONFIDENTIAL & PROPRIETARY — MEDISAFE RESEARCH ARCHITECTURE")
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 35, page_str)
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.75)
        self.line(54, 47, 558, 47)
        self.restoreState()

def build_pdf(filename="MediSafe_Chain_Component_Run_Flow_Data_Report.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    # Custom styles
    primary = colors.HexColor("#0F172A")    # Slate 900
    brand_blue = colors.HexColor("#1E40AF") # Blue 800
    teal_accent = colors.HexColor("#0D9488")# Teal 600
    dark_gray = colors.HexColor("#334155")  # Slate 700
    code_bg = colors.HexColor("#F8FAFC")    # Slate 50
    code_border = colors.HexColor("#E2E8F0")

    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=colors.HexColor("#0F2942")
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=brand_blue
    )
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#0F2942"),
        spaceBefore=14,
        spaceAfter=6
    )
    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=brand_blue,
        spaceBefore=10,
        spaceAfter=4
    )
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12.5,
        textColor=dark_gray
    )
    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=dark_gray,
        leftIndent=14
    )
    code_style = ParagraphStyle(
        'Code_Custom',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#0F172A")
    )
    badge_style = ParagraphStyle(
        'Badge_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white
    )
    th_style = ParagraphStyle(
        'TH_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=colors.white
    )
    td_style = ParagraphStyle(
        'TD_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=7.5,
        leading=10.5,
        textColor=dark_gray
    )
    td_bold = ParagraphStyle(
        'TDBold_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=10.5,
        textColor=colors.HexColor("#1E293B")
    )

    story = []

    # Title Banner Block
    banner_data = [
        [
            Paragraph("MEDISAFE CHAIN ARCHITECTURE SPECIFICATION", subtitle_style),
            Paragraph("REPORT REF: MED-2026-J26", ParagraphStyle('RRef', parent=body_style, alignment=2, textColor=colors.HexColor("#64748B"), fontName="Helvetica-Bold"))
        ],
        [
            Paragraph("Full Component Execution, Data Flow & Ingestion Payload Guide", title_style),
            ""
        ],
        [
            Paragraph("<b>Target System:</b> Intelligent Pharmaceutical Supply Chain Management System (J26-IT-317)<br/>"
                      "<b>Components Included:</b> Component 1 (Traceability), Component 2 (AI Risk Scoring), Component 3 (Pharmacy Trust), Component 4 (Prescription Zero-Knowledge Privacy)", body_style),
            ""
        ]
    ]
    t_banner = Table(banner_data, colWidths=[380, 124])
    t_banner.setStyle(TableStyle([
        ('SPAN', (0, 1), (1, 1)),
        ('SPAN', (0, 2), (1, 2)),
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ('PADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 6),
    ]))
    story.append(t_banner)
    story.append(Spacer(1, 12))

    # Executive Overview
    story.append(Paragraph("1. Executive Architecture Overview", h1_style))
    story.append(Paragraph(
        "MediSafe Chain is a decentralized, AI-augmented pharmaceutical integrity framework engineered to solve counterfeit drugs, illicit distribution, unverified retailers, and privacy leakage in patient medication regimes. The system coordinates across four specialized components interacting via smart contracts, off-chain cryptosystems (IPFS, Keccak-256 / AES-GCM), and RESTful microservices.",
        body_style
    ))
    story.append(Spacer(1, 6))

    # Architecture Overview Matrix Table
    comp_overview = [
        [Paragraph("Component", th_style), Paragraph("Stack / Runtime", th_style), Paragraph("Port / Network", th_style), Paragraph("Key Role in Supply Chain", th_style)],
        [
            Paragraph("<b>Comp 1: Traceability</b>", td_bold),
            Paragraph("Node.js / Express<br/>Ethers.js v6, IPFS", td_style),
            Paragraph("Port: <b>5001</b><br/>Hardhat / EVM", td_style),
            Paragraph("Manufacturer batch registration, custodian custody transfer, temperature and document anchoring.", td_style)
        ],
        [
            Paragraph("<b>Comp 2: AI Risk Scoring</b>", td_bold),
            Paragraph("Python 3.13 / FastAPI<br/>LightGBM, SHAP, Web3.py", td_style),
            Paragraph("Port: <b>8000</b><br/>Hardhat / EVM", td_style),
            Paragraph("Predictive counterfeit and anomaly detection, risk tiering (Low/Medium/High), on-chain risk registry.", td_style)
        ],
        [
            Paragraph("<b>Comp 3: Pharmacy Trust</b>", td_bold),
            Paragraph("Node.js microservice<br/>AHP weight engine, EVM", td_style),
            Paragraph("Port: <b>5003</b><br/>Hardhat / EVM", td_style),
            Paragraph("Regulatory license verification, inspection audits, cold-chain compliance, trust scoring (0-100).", td_style)
        ],
        [
            Paragraph("<b>Comp 4: Prescriptions</b>", td_bold),
            Paragraph("Node.js / Express, React<br/>Web Crypto, Ethers.js", td_style),
            Paragraph("Port: <b>5004</b><br/>Hardhat / EVM", td_style),
            Paragraph("Zero-knowledge doctor prescription issuance, blinded patient credential salt, single-dispense enforcement.", td_style)
        ],
    ]
    t_comp = Table(comp_overview, colWidths=[100, 105, 85, 214])
    t_comp.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0F2942")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(t_comp)
    story.append(Spacer(1, 14))

    # Component 1
    story.append(Paragraph("2. Component 1: Medicine Traceability & Custody Flow", h1_style))
    story.append(Paragraph(
        "<b>Run Command:</b> <code>cd backend/component1-traceability &amp;&amp; npm start</code> (Runs on Port <code>5001</code>)<br/>"
        "<b>Contract Deployed:</b> <code>MedicineTraceability.sol</code><br/>"
        "<b>Description:</b> Component 1 orchestrates the physical-to-digital chain of custody. It registers drug batches, stores certificates &amp; analysis reports on IPFS, and validates non-repudiable custodian handoffs between manufacturers, logistics operators, distributors, and dispensing pharmacies.",
        body_style
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("A. Execution Flow Steps:", h2_style))
    flow_c1 = [
        "1. <b>Batch Generation:</b> Manufacturer creates batch with lot number, manufacturing/expiry dates, formulation characteristics.",
        "2. <b>Document Staging:</b> Certificate of Analysis (CoA) and Lab test PDFs uploaded to <code>/api/v1/traceability/documents</code>, yielding SHA-256 IPFS CIDs.",
        "3. <b>On-Chain Registration:</b> Transaction prepared via <code>POST /api/v1/traceability/batches/transactions/register</code> and signed by manufacturer wallet.",
        "4. <b>Custody Handoff Initiation:</b> Current owner initiates transfer via <code>transactions/transfer</code> assigning target custodian address.",
        "5. <b>Custody Acceptance:</b> Receiving custodian confirms receipt and logs environmental conditions (temperature/humidity).",
        "6. <b>Query Verification:</b> Consumers or inspectors query <code>GET /api/v1/traceability/batches/:batchId/history</code> for the complete provenance trail."
    ]
    for step in flow_c1:
        story.append(Paragraph(step, bullet_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("B. Exact Ingestion Data Payloads (Component 1):", h2_style))
    c1_sample = """// POST /api/v1/traceability/batches/transactions/register
{
  "sender": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "batch": {
    "batchId": "BATCH-2026-AZ701",
    "medicineName": "Amoxicillin Trihydrate 500mg",
    "dosageForm": "Capsule",
    "strength": "500 mg",
    "quantity": 10000,
    "mfgTimestamp": 1776700800,
    "expiryTimestamp": 1839801600,
    "certificateReference": "ipfs://QmZtmD2qtQgqMwbtT5C43ZqJz8eFvN4L3fE5aE99m1vE9a",
    "documentReference": "ipfs://QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR"
  }
}

// POST /api/v1/traceability/batches/transactions/transfer
{
  "sender": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "batchId": "BATCH-2026-AZ701",
  "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "transferType": "DISTRIBUTOR_SHIPMENT",
  "shippingCondition": "COLD_CHAIN_2_TO_8C"
}"""
    t_c1_code = Table([[Paragraph(c1_sample.replace("\n", "<br/>").replace(" ", "&nbsp;"), code_style)]], colWidths=[504])
    t_c1_code.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), code_bg),
        ('BOX', (0, 0), (-1, -1), 0.75, code_border),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c1_code)

    story.append(PageBreak())

    # Component 2
    story.append(Paragraph("3. Component 2: AI Risk Scoring & Anomaly Detection", h1_style))
    story.append(Paragraph(
        "<b>Run Command:</b> <code>cd backend/component2-risk-scoring &amp;&amp; uvicorn main:app --reload --port 8000</code><br/>"
        "<b>Virtual Environment:</b> <code>.venv-component2</code><br/>"
        "<b>Contract Deployed:</b> <code>MedicineRiskRegistry.sol</code><br/>"
        "<b>Description:</b> Component 2 evaluates supply chain anomalies, high-risk drug formulations, atypical manufacturer shipping histories, and environmental excursions. It computes an ML risk score (0 to 100), categorizes risk (LOW, MEDIUM, HIGH), derives top SHAP feature drivers, and anchors assessments on-chain.",
        body_style
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("A. Execution Flow Steps:", h2_style))
    flow_c2 = [
        "1. <b>Batch Data Intake:</b> Component receives batch identifier and medicine profile metadata.",
        "2. <b>Historical Feature Fetching:</b> Aggregates custodian hops, transit duration, supplier risk history, and temperature telemetry.",
        "3. <b>Model Inference:</b> LightGBM classifier estimates likelihood of counterfeit, degradation, or diversion.",
        "4. <b>SHAP Explanation Engine:</b> Computes feature contribution values highlighting why a batch received its risk rating.",
        "5. <b>Risk Registry Anchor:</b> Invokes <code>POST /api/v1/risk/transactions/record</code> to write the assessment onto the blockchain registry.",
        "6. <b>Gateway Read &amp; Alert:</b> Consumers, pharmacies, and regulators inspect batch risk prior to acceptance or dispensing."
    ]
    for step in flow_c2:
        story.append(Paragraph(step, bullet_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("B. Exact Ingestion Data Payloads (Component 2):", h2_style))
    c2_sample = """// POST /api/v1/risk/assess
{
  "batch_id": "BATCH-2026-AZ701",
  "Name": "Amoxicillin Trihydrate 500mg",
  "Category": "Antibiotic",
  "Dosage Form": "Capsule",
  "Strength": "500 mg",
  "Manufacturer": "Apex Pharma Labs Ltd",
  "Indication": "Bacterial Infection",
  "Classification": "Prescription Only (POM)"
}

// POST /api/v1/risk/transactions/record
{
  "sender": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "batch_id": "BATCH-2026-AZ701",
  "Name": "Amoxicillin Trihydrate 500mg",
  "Category": "Antibiotic",
  "Dosage Form": "Capsule",
  "Strength": "500 mg",
  "Manufacturer": "Apex Pharma Labs Ltd",
  "Indication": "Bacterial Infection",
  "Classification": "Prescription Only (POM)"
}

// Response Output Model:
{
  "batch_id": "BATCH-2026-AZ701",
  "risk_score": 14.8,
  "risk_level": "LOW",
  "top_risk_factors": ["Manufacturer Reputable", "Cold Chain Maintained", "Normal Transit Time"],
  "model_version": "v2.4.0-lightgbm"
}"""
    t_c2_code = Table([[Paragraph(c2_sample.replace("\n", "<br/>").replace(" ", "&nbsp;"), code_style)]], colWidths=[504])
    t_c2_code.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), code_bg),
        ('BOX', (0, 0), (-1, -1), 0.75, code_border),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c2_code)
    story.append(Spacer(1, 14))

    # Component 3
    story.append(Paragraph("4. Component 3: Pharmacy Trust & Multi-Criteria Verification", h1_style))
    story.append(Paragraph(
        "<b>Run Command:</b> <code>cd backend/component3-pharmacy-trust &amp;&amp; node server.js</code> (Runs on Port <code>5003</code>)<br/>"
        "<b>Contract Deployed:</b> <code>PharmacyRegistry.sol</code><br/>"
        "<b>Description:</b> Evaluates pharmacy legitimacy and performance reliability using an Analytic Hierarchy Process (AHP) weighted model across licensing validity, regulatory inspection scores, counterfeit incident records, and storage compliance.",
        body_style
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("A. Execution Flow Steps:", h2_style))
    flow_c3 = [
        "1. <b>Identity Validation:</b> Validates Pharmacy ID formatting and resolves linked Ethereum wallet address.",
        "2. <b>Multi-Criteria Metric Aggregation:</b> Gathers current operating license status, state inspection scores, patient complaints, and cold storage sensor logs.",
        "3. <b>AHP Weighted Scoring:</b> Weights criteria (e.g. License Status: 35%, Audit Grade: 25%, Dispense Accuracy: 20%, Storage: 20%).",
        "4. <b>Trust Assessment Generation:</b> Computes composite Trust Score (0-100), Tier (Tier 1: High Trust, Tier 2: Monitored, Tier 3: Restricted).",
        "5. <b>Critical Findings Isolation:</b> Identifies non-conformances (e.g., license lapse, temperature alarm excursion).",
        "6. <b>On-Chain Verification:</b> Emits verifiable trust verification status for Component 4 prescription redemption."
    ]
    for step in flow_c3:
        story.append(Paragraph(step, bullet_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("B. Exact Ingestion Data Payloads & Endpoints (Component 3):", h2_style))
    c3_sample = """// GET /api/v1/pharmacies/PHARM-COLOMBO-04/trust-assessment
// Response Output Structure:
{
  "success": true,
  "pharmacyId": "PHARM-COLOMBO-04",
  "trustScore": 92.4,
  "tier": "TIER_1_CERTIFIED",
  "licenseStatus": "ACTIVE",
  "licenseExpiry": "2027-12-31T00:00:00Z",
  "metrics": {
    "auditScore": 95,
    "coldChainComplianceRate": 99.2,
    "incidentCount": 0,
    "dispenseFulfillmentRate": 98.7
  },
  "verifiedTimestamp": 1776701000
}

// GET /api/v1/pharmacies/PHARM-COLOMBO-04/trust-assessment/critical-findings
{
  "success": true,
  "pharmacyId": "PHARM-COLOMBO-04",
  "findingsCount": 0,
  "criticalAlerts": []
}"""
    t_c3_code = Table([[Paragraph(c3_sample.replace("\n", "<br/>").replace(" ", "&nbsp;"), code_style)]], colWidths=[504])
    t_c3_code.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), code_bg),
        ('BOX', (0, 0), (-1, -1), 0.75, code_border),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c3_code)

    story.append(PageBreak())

    # Component 4
    story.append(Paragraph("5. Component 4: Zero-Knowledge Prescription & Wallet Dispensing", h1_style))
    story.append(Paragraph(
        "<b>Run Command:</b> <code>cd backend/component4-prescription &amp;&amp; node server.js</code> (Runs on Port <code>5004</code>)<br/>"
        "<b>Contract Deployed:</b> <code>PrescriptionRegistry.sol</code> (Local Hardhat: <code>0x5FbDB2315678afecb367f032d93F642f64180aa3</code>)<br/>"
        "<b>Description:</b> Component 4 handles privacy-preserving e-prescriptions. Patient identities are never stored plaintext on the blockchain; instead, a blinded commitment hash <code>Keccak256(NationalID + Salt)</code> is stored. Doctors issue signed commitments directly through MetaMask wallet transactions, and pharmacies dispense them in a single-use atomic operation.",
        body_style
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("A. Execution Flow Steps:", h2_style))
    flow_c4 = [
        "1. <b>EIP-4361 Web3 Authentication:</b> Client challenges server (<code>POST /api/v1/prescriptions/auth/challenge</code>), signs challenge in wallet, exchanges signature for scoped JWT (<code>POST /api/v1/prescriptions/auth/token</code>).",
        "2. <b>Patient Hash Commitment:</b> Doctor enters Patient ID. Web App generates cryptographically secure 16-byte random salt, calculates <code>patientHash = keccak256(patientId + salt)</code>.",
        "3. <b>Credential File Download:</b> Client downloads encrypted JSON credential (<code>medisafe-patient-presentation.json</code>) containing salt &amp; patient credentials to be stored offline by the patient.",
        "4. <b>Direct Blockchain Issuance:</b> Doctor submits <code>issuePrescription(patientHash, medicineId, batchId, expiryTimestamp)</code> directly from MetaMask to the Smart Contract.",
        "5. <b>Prescription Redemption at Pharmacy:</b> Patient uploads encrypted presentation file and unlocks with passphrase.",
        "6. <b>Trust Pre-flight &amp; Dispensing:</b> App verifies pharmacy status via Component 3, confirms batch authenticity via Component 1 &amp; 2, and pharmacy executes <code>dispensePrescription(prescriptionId, patientSecretKey)</code>, marking prescription irrevocably consumed."
    ]
    for step in flow_c4:
        story.append(Paragraph(step, bullet_style))
    story.append(Spacer(1, 6))

    story.append(Paragraph("B. Exact Ingestion Data Payloads (Component 4):", h2_style))
    c4_sample = """// 1. POST /api/v1/prescriptions/auth/challenge
{
  "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
}

// 2. POST /api/v1/prescriptions/auth/token
{
  "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "signature": "0x6f9b8c...",
  "nonce": "a7b3c4d5e6f7"
}

// 3. Smart Contract Direct Invocation (Doctor MetaMask):
// issuePrescription(bytes32 patientHash, string medicineId, string batchId, uint256 expiryTimestamp)
[
  "0xd4e56790a12b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
  "MED-AMOX-500",
  "BATCH-2026-AZ701",
  1839801600
]

// 4. Patient Encrypted Presentation Credential (medisafe-patient-presentation.json):
{
  "version": "1.0",
  "patientHash": "0xd4e56790a12b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
  "saltHex": "0x89ab12cd34ef567890abcdef12345678",
  "medicineId": "MED-AMOX-500",
  "batchId": "BATCH-2026-AZ701",
  "issuedAt": 1776701200
}"""
    t_c4_code = Table([[Paragraph(c4_sample.replace("\n", "<br/>").replace(" ", "&nbsp;"), code_style)]], colWidths=[504])
    t_c4_code.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), code_bg),
        ('BOX', (0, 0), (-1, -1), 0.75, code_border),
        ('PADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(t_c4_code)

    story.append(PageBreak())

    # Frontend and Unified End-to-End Orchestration
    story.append(Paragraph("6. Unified End-to-End Run Order & System Orchestration", h1_style))
    story.append(Paragraph(
        "To execute the entire MediSafe Chain platform in local development or testbed staging, launch services in the precise operational order detailed below. All components connect through the local Ethereum node and the unified Vite/React frontend.",
        body_style
    ))
    story.append(Spacer(1, 6))

    startup_table_data = [
        [Paragraph("Order", th_style), Paragraph("Component / Layer", th_style), Paragraph("Startup Command", th_style), Paragraph("Expected Listening Port", th_style)],
        [Paragraph("<b>Step 1</b>", td_bold), Paragraph("Local EVM Blockchain", td_style), Paragraph("<code>cd blockchain &amp;&amp; npx hardhat node</code>", td_style), Paragraph("<b>8545</b> (JSON-RPC)", td_style)],
        [Paragraph("<b>Step 2</b>", td_bold), Paragraph("Smart Contracts Deploy", td_style), Paragraph("<code>cd blockchain &amp;&amp; npx hardhat run scripts/deploy.js --network localhost</code>", td_style), Paragraph("Contract addresses emitted", td_style)],
        [Paragraph("<b>Step 3</b>", td_bold), Paragraph("Traceability API (Comp 1)", td_style), Paragraph("<code>cd backend/component1-traceability &amp;&amp; npm start</code>", td_style), Paragraph("<b>5001</b>", td_style)],
        [Paragraph("<b>Step 4</b>", td_bold), Paragraph("Risk Scoring API (Comp 2)", td_style), Paragraph("<code>cd backend/component2-risk-scoring &amp;&amp; uvicorn main:app --port 8000</code>", td_style), Paragraph("<b>8000</b>", td_style)],
        [Paragraph("<b>Step 5</b>", td_bold), Paragraph("Pharmacy Trust (Comp 3)", td_style), Paragraph("<code>cd backend/component3-pharmacy-trust &amp;&amp; node server.js</code>", td_style), Paragraph("<b>5003</b>", td_style)],
        [Paragraph("<b>Step 6</b>", td_bold), Paragraph("Prescription API (Comp 4)", td_style), Paragraph("<code>cd backend/component4-prescription &amp;&amp; node server.js</code>", td_style), Paragraph("<b>5004</b>", td_style)],
        [Paragraph("<b>Step 7</b>", td_bold), Paragraph("Unified React Frontend", td_style), Paragraph("<code>cd frontend &amp;&amp; npm run dev</code>", td_style), Paragraph("<b>5173</b>", td_style)],
    ]
    t_startup = Table(startup_table_data, colWidths=[45, 125, 230, 104])
    t_startup.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0F2942")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(t_startup)
    story.append(Spacer(1, 14))

    # Cross-Component Data Flow Lifecycle
    story.append(Paragraph("7. Cross-Component Data Flow Lifecycle", h1_style))
    story.append(Paragraph(
        "The following matrix summarizes how data models transition across component boundaries throughout a drug's lifecycle:",
        body_style
    ))
    story.append(Spacer(1, 6))

    lifecycle_data = [
        [Paragraph("Lifecycle Stage", th_style), Paragraph("Origin &amp; Ingestion Target", th_style), Paragraph("Input Data Key Fields", th_style), Paragraph("Resulting Output Artifact", th_style)],
        [
            Paragraph("<b>Batch Inception</b>", td_bold),
            Paragraph("Manufacturer &rarr; Component 1", td_style),
            Paragraph("BatchId, LotQty, Expiry, CoA Hash, Mfg Timestamp", td_style),
            Paragraph("On-chain Batch Registration &amp; IPFS Pin", td_style)
        ],
        [
            Paragraph("<b>Risk Evaluation</b>", td_bold),
            Paragraph("Component 1 &rarr; Component 2", td_style),
            Paragraph("BatchId, Dosage Form, Manufacturer, Class, Route", td_style),
            Paragraph("ML Risk Score (0-100), SHAP Drivers, Risk Registry Tx", td_style)
        ],
        [
            Paragraph("<b>Transit &amp; Custody</b>", td_bold),
            Paragraph("Logistics &rarr; Component 1", td_style),
            Paragraph("BatchId, NextCustodianAddress, EnvLogs, SealHash", td_style),
            Paragraph("Updated Custody History on EVM", td_style)
        ],
        [
            Paragraph("<b>Pharmacy Audit</b>", td_bold),
            Paragraph("Regulator &rarr; Component 3", td_style),
            Paragraph("PharmacyId, LicenseId, ColdChainLog, AuditScores", td_style),
            Paragraph("AHP Trust Score (0-100) &amp; Trust Tier Badge", td_style)
        ],
        [
            Paragraph("<b>Prescription Issue</b>", td_bold),
            Paragraph("Doctor &rarr; Component 4", td_style),
            Paragraph("PatientId, Salt, MedicineId, BatchId, ExpiryDays", td_style),
            Paragraph("Blinded Patient Hash on EVM + Encrypted JSON File", td_style)
        ],
        [
            Paragraph("<b>Dispensing Verification</b>", td_bold),
            Paragraph("Patient &rarr; Pharmacy &rarr; Comp 1, 2, 3, 4", td_style),
            Paragraph("Encrypted Credential File, Passphrase, Pharmacy Signer", td_style),
            Paragraph("Single-dispense Mark on-chain; Complete audit log", td_style)
        ],
    ]
    t_lifecycle = Table(lifecycle_data, colWidths=[90, 110, 160, 144])
    t_lifecycle.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0F2942")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(t_lifecycle)
    story.append(Spacer(1, 14))

    # Environment Variables & Configuration Checklist
    story.append(Paragraph("8. Required Environment Variables Reference", h1_style))
    env_data = [
        [Paragraph("Component", th_style), Paragraph("Key Variable", th_style), Paragraph("Default / Example Value", th_style), Paragraph("Purpose", th_style)],
        [Paragraph("<b>Component 1</b>", td_bold), Paragraph("<code>PORT</code><br/><code>RPC_URL</code><br/><code>CONTRACT_ADDRESS</code>", code_style), Paragraph("5001<br/>http://127.0.0.1:8545<br/>0x5FbDB2315678afec...", td_style), Paragraph("Express API port and blockchain RPC configuration.", td_style)],
        [Paragraph("<b>Component 2</b>", td_bold), Paragraph("<code>TRACEABILITY_API_URL</code><br/><code>RISK_REGISTRY_ADDRESS</code>", code_style), Paragraph("http://127.0.0.1:5001<br/>0xe7f1725E07cf5523...", td_style), Paragraph("Integration with Comp 1 and Web3 registry client.", td_style)],
        [Paragraph("<b>Component 3</b>", td_bold), Paragraph("<code>PORT</code><br/><code>PHARMACY_REGISTRY_ADDRESS</code>", code_style), Paragraph("5003<br/>0x9fE46736679d2D9a...", td_style), Paragraph("Trust scoring endpoint and pharmacy validation.", td_style)],
        [Paragraph("<b>Component 4</b>", td_bold), Paragraph("<code>PORT</code><br/><code>JWT_SECRET</code><br/><code>PRESCRIPTION_REGISTRY_ADDRESS</code>", code_style), Paragraph("5004<br/>medisafe-super-secret<br/>0xCf7Ed3AccA5a467e...", td_style), Paragraph("EIP-4361 authentication session token &amp; contract target.", td_style)],
    ]
    t_env = Table(env_data, colWidths=[90, 140, 134, 140])
    t_env.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0F2942")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('PADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(t_env)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF at: {filename}")

if __name__ == '__main__':
    build_pdf()
