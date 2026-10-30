import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def create_document():
    doc = docx.Document()

    # Set 1 inch margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    # Palette
    PRIMARY = RGBColor(8, 125, 102)     # #087D66 Teal
    SECONDARY = RGBColor(30, 41, 59)   # Slate 800
    CODE_COLOR = RGBColor(15, 23, 42)  # Dark
    BG_TEAL = "E6F4F1"
    BORDER_TEAL = "087D66"

    def set_cell_background(cell, fill_hex):
        shading_elm = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
        cell._tc.get_or_add_tcPr().append(shading_elm)

    def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = OxmlElement('w:tcMar')
        for m, val in [('w:top', top), ('w:bottom', bottom), ('w:left', left), ('w:right', right)]:
            node = OxmlElement(m)
            node.set(qn('w:w'), str(val))
            node.set(qn('w:type'), 'dxa')
            tcMar.append(node)
        tcPr.append(tcMar)

    # Title
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_sub = p_title.add_run("MEDISAFE CHAIN — COMPONENT 4\n")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(11)
    r_sub.font.bold = True
    r_sub.font.color.rgb = PRIMARY

    r_main = p_title.add_run("Privacy-Preserving Prescription Management\nComplete Guidance & Data Flow Specification")
    r_main.font.name = "Arial"
    r_main.font.size = Pt(20)
    r_main.font.bold = True
    r_main.font.color.rgb = SECONDARY

    # Meta Table
    meta_table = doc.add_table(rows=4, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        ("Author / Researcher:", "R.A.M.A. Ranasinghe (IT23142978)"),
        ("Smart Contract:", "PrescriptionRegistry.sol (Chain ID: 31337 / Hardhat Localhost)"),
        ("API & Web Stack:", "Node.js/Express (Port 5004) & React/Vite (Port 5173)"),
        ("Cross-Component Links:", "Component 2 (Risk Registry) & Component 3 (Pharmacy Trust)")
    ]
    for i, (k, v) in enumerate(meta_data):
        row = meta_table.rows[i]
        c0, c1 = row.cells[0], row.cells[1]
        c0.width = Inches(2.2)
        c1.width = Inches(4.3)
        set_cell_background(c0, "F1F5F9")
        set_cell_background(c1, "F8FAFC")
        set_cell_margins(c0, 60, 60, 100, 100)
        set_cell_margins(c1, 60, 60, 100, 100)
        
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(k)
        r0.font.name = "Arial"
        r0.font.bold = True
        r0.font.size = Pt(9.5)
        r0.font.color.rgb = SECONDARY
        
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(v)
        r1.font.name = "Arial"
        r1.font.size = Pt(9.5)
        r1.font.color.rgb = SECONDARY

    doc.add_paragraph()

    def add_section_header(title):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        pBdr = parse_xml(f'<w:pBdr {nsdecls("w")}><w:bottom w:val="single" w:sz="14" w:space="4" w:color="{BORDER_TEAL}"/></w:pBdr>')
        p._p.get_or_add_pPr().append(pBdr)
        r = p.add_run(title)
        r.font.name = "Arial"
        r.font.size = Pt(13)
        r.font.bold = True
        r.font.color.rgb = PRIMARY
        return p

    def add_callout(text, title="NOTE"):
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.rows[0].cells[0]
        cell.width = Inches(6.5)
        set_cell_background(cell, BG_TEAL)
        set_cell_margins(cell, 100, 100, 140, 140)
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:top w:val="none"/>'
            f'<w:left w:val="single" w:sz="24" w:color="{BORDER_TEAL}"/>'
            f'<w:bottom w:val="none"/>'
            f'<w:right w:val="none"/>'
            f'</w:tcBorders>'
        )
        cell._tc.get_or_add_tcPr().append(borders)
        p = cell.paragraphs[0]
        r_title = p.add_run(f"[{title}] ")
        r_title.font.name = "Arial"
        r_title.font.bold = True
        r_title.font.size = Pt(9.5)
        r_title.font.color.rgb = PRIMARY
        
        r_text = p.add_run(text)
        r_text.font.name = "Arial"
        r_text.font.size = Pt(9.5)
        r_text.font.color.rgb = SECONDARY
        doc.add_paragraph()

    def add_code_block(code_str):
        tbl = doc.add_table(rows=1, cols=1)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = tbl.rows[0].cells[0]
        cell.width = Inches(6.5)
        set_cell_background(cell, "F1F5F9")
        set_cell_margins(cell, 80, 80, 120, 120)
        borders = parse_xml(
            f'<w:tcBorders {nsdecls("w")}>'
            f'<w:top w:val="single" w:sz="6" w:color="CBD5E1"/>'
            f'<w:left w:val="single" w:sz="6" w:color="CBD5E1"/>'
            f'<w:bottom w:val="single" w:sz="6" w:color="CBD5E1"/>'
            f'<w:right w:val="single" w:sz="6" w:color="CBD5E1"/>'
            f'</w:tcBorders>'
        )
        cell._tc.get_or_add_tcPr().append(borders)
        p = cell.paragraphs[0]
        p.paragraph_format.line_spacing = 1.1
        r = p.add_run(code_str)
        r.font.name = "Consolas"
        r.font.size = Pt(8.5)
        r.font.color.rgb = CODE_COLOR
        doc.add_paragraph()

    # SECTION 1
    add_section_header("1. Executive Summary & Core Architectural Principles")
    p = doc.add_paragraph()
    p.add_run(
        "Component 4 of the MediSafe Chain platform governs the complete lifecycle of pharmaceutical prescriptions. "
        "In healthcare supply chains, patient privacy, prescription authenticity, and double-dispense prevention are paramount. "
        "Component 4 resolves these challenges by uniting zero-knowledge client-side privacy, direct wallet signing, and multi-layered on-chain smart contract validation.\n"
    )

    doc.add_paragraph(
        "• Zero Personally Identifiable Information (PII) On-Chain: No patient name, date of birth, national ID, or illness data is ever committed to the blockchain or stored on backend servers. Only salt-randomized Keccak256 hashes are stored.\n"
        "• Client-Side Encryption: Patient identity records are protected with AES-256-GCM and PBKDF2-SHA256 (310,000 iterations), remaining exclusively in the patient's local custody.\n"
        "• Strict Single-Use Enforcement: Smart contract state machines permanently transition prescriptions to status 'USED' upon dispensing, eliminating counterfeit reuse or duplicate claims.\n"
        "• Multi-Component Oracle Validation: Before dispensing, the smart contract verifies Component 2 (AI Risk Score <= 69) and Component 3 (Pharmacy Trust Score >= 70)."
    )

    # SECTION 2
    add_section_header("2. Roles, Accounts & Network Configuration")
    doc.add_paragraph("The system uses OpenZeppelin AccessControl. The following pre-configured accounts are funded and assigned roles in the local Hardhat test network (Chain ID: 31337):")

    role_tbl = doc.add_table(rows=5, cols=4)
    role_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Role / Actor", "Address", "Role Constant", "Permissions & Responsibilities"]
    for col_idx, text in enumerate(headers):
        c = role_tbl.rows[0].cells[col_idx]
        set_cell_background(c, "087D66")
        set_cell_margins(c, 80, 80, 100, 100)
        p = c.paragraphs[0]
        r = p.add_run(text)
        r.font.name = "Arial"
        r.font.bold = True
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor(255, 255, 255)

    roles_data = [
        ("Doctor (Account 1)", "0x2a13ee1f4C69386864A271Bceb401fcd3d91c942", "DOCTOR_ROLE", "Issue new prescriptions, revoke active prescriptions."),
        ("Pharmacy (Account 2)", "0x2376C6970c55AB66c4FFcad53A49fb21f862B613", "PHARMACY_ROLE", "Verify patient credentials, execute dispensing on-chain."),
        ("Patient (Account 3)", "0x7465C8b4C7a9068c440044222539f993bf4537A7", "Off-chain Identity", "Generate cryptographic salt/hash, export pharmacy presentation."),
        ("Admin (Account 4)", "0xd2F150C082261e31F7504f129C799218186C4701", "DEFAULT_ADMIN_ROLE", "Manage roles, update oracle contracts and risk thresholds.")
    ]

    for row_idx, data in enumerate(roles_data):
        row = role_tbl.rows[row_idx + 1]
        for col_idx, text in enumerate(data):
            c = row.cells[col_idx]
            set_cell_background(c, "F8FAFC" if row_idx % 2 == 0 else "FFFFFF")
            set_cell_margins(c, 60, 60, 80, 80)
            p = c.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Arial"
            r.font.size = Pt(8)
            r.font.color.rgb = SECONDARY

    doc.add_paragraph()

    # SECTION 3
    add_section_header("3. Complete Step-by-Step Flow with Exact Data")

    # Step 1
    p_s1 = doc.add_paragraph()
    r = p_s1.add_run("STAGE 1: Patient Identity Preparation & Credential Creation")
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = PRIMARY
    
    doc.add_paragraph(
        "1. Open http://localhost:5173 and click 'Prepare a patient credential'.\n"
        "2. The patient fills in their private identity details (or clicks 'Auto-fill test data'):\n"
        "   • National ID / Passport:  200112345678\n"
        "   • Full Legal Name:        John Doe\n"
        "   • Date of Birth:          2001-07-21 (or 07/21/2001)\n"
        "   • Secret Passphrase:      MedisafeSecret2026! (at least 12 characters)"
    )

    doc.add_paragraph("3. The client application normalizes the identity fields into canonical format:")
    add_code_block("dateofbirth:2001-07-21|fullname:john doe|nationalid:200112345678")

    doc.add_paragraph(
        "4. A random 32-byte salt is generated (e.g. 0x7c4f1e...)\n"
        "5. The Patient Hash is computed using Keccak-256:\n"
        "   patientHash = solidityPackedKeccak256(['string', 'bytes32'], [canonicalIdentity, salt])\n"
        "   Result: 0x3a890f5c1209b5329fce831d10294c8e718290f6e3c1294801fb2941038e92d1\n"
        "6. The client encrypts the payload into 'medisafe-patient-preparation.json' using PBKDF2-SHA256 (310,000 iterations) + AES-256-GCM."
    )

    add_callout(
        "The patient keeps 'medisafe-patient-preparation.json' on their device. "
        "The patient ONLY shares the public 'patientHash' with their doctor. "
        "No doctor, backend server, or blockchain node ever sees the patient's name or national ID.",
        "ZERO-KNOWLEDGE PRIVACY"
    )

    # Step 2
    p_s2 = doc.add_paragraph()
    r = p_s2.add_run("STAGE 2: Doctor Issues Prescription on Blockchain")
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = PRIMARY

    doc.add_paragraph(
        "1. In MetaMask, select the Doctor account (0x2a13ee1f4C69386864A271Bceb401fcd3d91c942).\n"
        "2. Select the 'Doctor' role on the login screen and click 'Connect MetaMask & Sign In'.\n"
        "3. MetaMask prompts to sign the EIP-191 authentication challenge issued by the API (Port 5004).\n"
        "4. In the Doctor Dashboard under 'Issue a prescription', enter the following data:\n"
        "   • Patient Privacy Hash:  [Paste the patientHash from Stage 1]\n"
        "   • Medicine ID:           MED-AMOX-500\n"
        "   • Batch ID:              BATCH-SAFE-001  (or BATCH-2026-01)\n"
        "   • Validity Period:       30 days"
    )

    doc.add_paragraph(
        "5. Click 'Issue prescription'. The frontend computes a unique 32-byte Prescription ID:\n"
        "   prescriptionId = keccak256(doctorAddress, patientHash, timestamp + nonce)\n"
        "   Example: 0x8a91bc74...12f0\n"
        "6. MetaMask prompts to confirm the transaction calling PrescriptionRegistry.issuePrescription().\n"
        "7. The blockchain confirms the block, sets status to ACTIVE, and emits PrescriptionIssued event.\n"
        "8. Copy the generated Prescription ID from the success alert."
    )

    # Step 3
    p_s3 = doc.add_paragraph()
    r = p_s3.add_run("STAGE 3: Patient Prepares Scoped Presentation for Pharmacy")
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = PRIMARY

    doc.add_paragraph(
        "1. In MetaMask, switch to the Patient account (0x2376C6970c55AB66c4FFcad53A49fb21f862B613).\n"
        "2. On the login screen, select 'Patient' and enter the Prescription ID from Stage 2.\n"
        "3. On the 'Verify your identity' screen, provide:\n"
        "   • Encrypted Preparation Credential:  Upload medisafe-patient-preparation.json\n"
        "   • Credential Passphrase:            MedisafeSecret2026!\n"
        "   • New Pharmacy Passphrase:          PharmacyPass123!\n"
        "   • Intended Pharmacy Wallet:         0x7465C8b4C7a9068c440044222539f993bf4537A7\n"
        "4. Click 'Verify and prepare pharmacy handoff'.\n"
        "5. A new scoped file named 'medisafe-pharmacy-presentation.json' is generated and downloaded."
    )

    add_code_block(
'''{
  "kind": "medisafe-patient-presentation-v1",
  "prescriptionId": "0x8a91bc74...12f0",
  "patientHash": "0x3a890f5c1209b5329fce831d10294c8e718290f6e3c1294801fb2941038e92d1",
  "chainId": "31337",
  "registryAddress": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  "pharmacyAddress": "0x7465C8b4C7a9068c440044222539f993bf4537A7",
  "expiryTime": 1732120900
}'''
    )

    add_callout(
        "Presentation Scoping Protection: If an unauthorized third party intercepts this presentation, "
        "they cannot use it at another pharmacy or on another blockchain network. "
        "The smart contract enforces that msg.sender must match pharmacyAddress.",
        "ANTI-REPLAY SECURITY"
    )

    # Step 4
    p_s4 = doc.add_paragraph()
    r = p_s4.add_run("STAGE 4: Pharmacy Multi-Layer Verification & Dispensing")
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = PRIMARY

    doc.add_paragraph(
        "1. In MetaMask, switch to the Pharmacy account (0x7465C8b4C7a9068c440044222539f993bf4537A7).\n"
        "2. Sign in as Pharmacy on http://localhost:5173.\n"
        "3. On the Pharmacy desk, provide:\n"
        "   • Encrypted Patient Presentation: Upload medisafe-pharmacy-presentation.json\n"
        "   • Credential Passphrase:          PharmacyPass123!\n"
        "4. Click 'Verify & dispense medication'.\n"
        "5. MetaMask pops up to execute verifyAndDispenseWithPatientHash(prescriptionId, presentedPatientHash)."
    )

    doc.add_paragraph("The Smart Contract atomically executes 5 security gates in a single transaction:")

    gate_tbl = doc.add_table(rows=6, cols=3)
    gate_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    g_headers = ["Gate #", "Validation Target", "Smart Contract Assertion / Rule"]
    for idx, text in enumerate(g_headers):
        c = gate_tbl.rows[0].cells[idx]
        set_cell_background(c, "087D66")
        set_cell_margins(c, 70, 70, 90, 90)
        p = c.paragraphs[0]
        r = p.add_run(text)
        r.font.name = "Arial"
        r.font.bold = True
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor(255, 255, 255)

    gates = [
        ("Gate 1", "Existence & Expiry", "p.prescriptionId != 0 && block.timestamp <= p.expiryTime"),
        ("Gate 2", "Single-Use State", "p.status == PrescriptionStatus.ACTIVE (rejects USED / REVOKED)"),
        ("Gate 3", "Patient Hash Match", "p.patientHash == presentedPatientHash"),
        ("Gate 4", "Component 2 AI Risk", "riskRegistry.getRiskScore(batchId) <= 69 && isBatchSafe == true"),
        ("Gate 5", "Component 3 Trust Score", "pharmacyTrust.getTrustScore(msg.sender) >= 70 && isPharmacyTrusted == true")
    ]
    for row_idx, data in enumerate(gates):
        row = gate_tbl.rows[row_idx + 1]
        for col_idx, text in enumerate(data):
            c = row.cells[col_idx]
            set_cell_background(c, "F8FAFC" if row_idx % 2 == 0 else "FFFFFF")
            set_cell_margins(c, 60, 60, 80, 80)
            p = c.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Arial"
            r.font.size = Pt(8.5)
            r.font.color.rgb = SECONDARY

    doc.add_paragraph()
    doc.add_paragraph(
        "Upon successful execution:\n"
        "• The status is permanently changed to PrescriptionStatus.USED.\n"
        "• Events PrescriptionDispensed and PrescriptionStatusChanged are emitted.\n"
        "• The pharmacist receives instant on-screen confirmation that the medication is authentic, safe, and officially dispensed."
    )

    # SECTION 4
    add_section_header("4. Smart Contract Schema & Events Reference")
    doc.add_paragraph("Solidity struct definition in PrescriptionRegistry.sol:")
    add_code_block(
'''enum PrescriptionStatus {
    ACTIVE,   // 0: Valid, available to dispense
    USED,     // 1: Dispensed once, permanently consumed
    EXPIRED,  // 2: Exceeded validity timestamp
    REVOKED   // 3: Cancelled by issuing doctor or admin
}

struct Prescription {
    bytes32 prescriptionId;    // Unique 32-byte identifier
    bytes32 patientHash;       // Off-chain Keccak-256 patient identity hash
    string medicineId;         // E.g. "MED-AMOX-500"
    string batchId;            // E.g. "BATCH-SAFE-001"
    address doctorAddress;     // On-chain issuer address
    uint256 issuedAt;          // UNIX block timestamp at creation
    uint256 expiryTime;        // UNIX block timestamp for expiration
    PrescriptionStatus status; // Enum tracking single-use lifecycle
}'''
    )

    # SECTION 5
    add_section_header("5. VS Code Execution Quick Reference")
    doc.add_paragraph("To run Component 4 in VS Code, open 3 terminal tabs:")
    doc.add_paragraph(
        "Terminal 1 (Blockchain):\n"
        "  cd blockchain\n"
        "  npx hardhat node\n"
        "  npx hardhat run ../scripts/setup/setup_component4_demo.js --network localhost\n\n"
        "Terminal 2 (Backend API):\n"
        "  cd backend/component4-prescription\n"
        "  node server.js\n\n"
        "Terminal 3 (Frontend Web App):\n"
        "  cd frontend\n"
        "  npm run dev\n\n"
        "Then visit http://localhost:5173 in Google Chrome with MetaMask connected to Hardhat Localhost (http://127.0.0.1:8545, Chain ID: 31337)."
    )

    output_path = "Component_4_Complete_Guidance_and_Data_Flow.docx"
    doc.save(output_path)
    print(f"SUCCESS: {output_path} created successfully!")

if __name__ == "__main__":
    create_document()
