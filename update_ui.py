with open('frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update submitIssue
old1 = '''      setIssueForm(EMPTY_FORM);
      setNotice({ type: "success", message: `Prescription issued by ${session.address}. ID: ${args[0]}. Confirmed in block ${result.blockNumber}.` });'''
new1 = '''      try {
        sessionStorage.setItem("lastIssuedPrescriptionId", args[0]);
        sessionStorage.setItem("lastIssuedPatientHash", (issueForm.patientHash || "").trim());
      } catch (_) {}
      setIssueForm(EMPTY_FORM);
      setNotice({ type: "success", message: `Prescription issued by ${session.address}. ID: ${args[0]}. Confirmed in block ${result.blockNumber}.` });'''

if old1 in content:
    content = content.replace(old1, new1, 1)
    print('1. submitIssue replaced')
else:
    print('1. NOT found')

# 2. Update patientScope in AuthScreen
old2 = '''{role === "patient" && <div className="field-block patient-scope-field"><label htmlFor="patient-scope-id">Prescription ID for verification</label><input id="patient-scope-id" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={patientPrescriptionId} onChange={(event) => setPatientPrescriptionId(event.target.value)} pattern="0x[0-9a-fA-F]{64}" required/><span className="field-help">The signed session will be limited to this prescription only.</span></div>}'''
new2 = '''{role === "patient" && <div className="field-block patient-scope-field"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><label htmlFor="patient-scope-id">Prescription ID for verification</label>{typeof window !== "undefined" && window.sessionStorage?.getItem("lastIssuedPrescriptionId") && <button type="button" style={{ fontSize: "12px", color: "#087D66", fontWeight: "bold", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setPatientPrescriptionId(window.sessionStorage.getItem("lastIssuedPrescriptionId")); setError(""); }}>⚡ Auto-fill last issued Rx</button>}</div><input id="patient-scope-id" className="mono-input" spellCheck="false" autoComplete="off" placeholder="0x followed by 64 hexadecimal characters" value={patientPrescriptionId} onChange={(event) => setPatientPrescriptionId(event.target.value)} pattern="0x[0-9a-fA-F]{64}" required/><span className="field-help">The signed session will be limited to this prescription only.</span></div>}'''

if old2 in content:
    content = content.replace(old2, new2, 1)
    print('2. patientScope replaced')
else:
    print('2. NOT found')

# 3. Update PatientDashboard pharmacyAddress default
old3 = '''  const [passphrase, setPassphrase] = useState("");
  const [presentationPassphrase, setPresentationPassphrase] = useState("");
  const [pharmacyAddress, setPharmacyAddress] = useState("");'''
new3 = '''  const [passphrase, setPassphrase] = useState("");
  const [presentationPassphrase, setPresentationPassphrase] = useState("");
  const [pharmacyAddress, setPharmacyAddress] = useState("0x7465C8b4C7a9068c440044222539f993bf4537A7");'''

if old3 in content:
    content = content.replace(old3, new3, 1)
    print('3. pharmacyAddress default replaced')
else:
    print('3. NOT found')

# 4. Add auto-fill in PatientDashboard form
old4 = '''<form onSubmit={verifyCredential} className="form-stack" autoComplete="off">'''
new4 = '''<form onSubmit={verifyCredential} className="form-stack" autoComplete="off">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
              <button type="button" className="button button-secondary" style={{ fontSize: "12px", padding: "4px 10px" }} onClick={() => { setPassphrase("VivaDemoPass2026!"); setPresentationPassphrase("PharmacyPass2026!"); setPharmacyAddress("0x7465C8b4C7a9068c440044222539f993bf4537A7"); }}>
                ⚡ Auto-fill demo passphrases &amp; pharmacy
              </button>
            </div>'''

if old4 in content:
    content = content.replace(old4, new4, 1)
    print('4. PatientDashboard auto-fill added')
else:
    print('4. NOT found')

# 5. Add auto-fill in Pharmacy desk form
old5 = '''<div className="field-block"><label htmlFor="dispense-passphrase">Credential passphrase</label><input id="dispense-passphrase" type="password" autoComplete="off" value={dispenseForm.passphrase} onChange={(e) => setDispenseForm({ ...dispenseForm, passphrase: e.target.value })} required/></div>'''
new5 = '''<div className="field-block"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><label htmlFor="dispense-passphrase">Credential passphrase</label><button type="button" style={{ fontSize: "11px", color: "#087D66", fontWeight: "bold", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onClick={() => setDispenseForm(f => ({ ...f, passphrase: "PharmacyPass2026!" }))}>⚡ Auto-fill demo passphrase</button></div><input id="dispense-passphrase" type="password" autoComplete="off" value={dispenseForm.passphrase} onChange={(e) => setDispenseForm({ ...dispenseForm, passphrase: e.target.value })} required/></div>'''

if old5 in content:
    content = content.replace(old5, new5, 1)
    print('5. Pharmacy desk auto-fill added')
else:
    print('5. NOT found')

# 6. Add auto-fill in Doctor Issue form
old6 = '''<form onSubmit={submitIssue} className="form-stack dashboard-form">'''
new6 = '''<form onSubmit={submitIssue} className="form-stack dashboard-form">
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
                  <button type="button" className="button button-secondary" style={{ fontSize: "12px", padding: "4px 10px" }} onClick={() => setIssueForm(prev => ({ ...prev, medicineId: "MED-AUGMENTIN-625", batchId: "BATCH-VIVA-001", expiryDays: 30 }))}>
                    ⚡ Auto-fill medicine &amp; safe batch
                  </button>
                </div>'''

if old6 in content:
    content = content.replace(old6, new6, 1)
    print('6. Doctor issue auto-fill added')
else:
    print('6. NOT found')

with open('frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('All updates completed successfully!')
