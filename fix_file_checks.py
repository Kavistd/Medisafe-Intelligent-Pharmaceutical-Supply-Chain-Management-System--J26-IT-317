with open('frontend/src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Align passphrases in Step 3 Auto-fill:
# Replace VivaDemoPass2026! with MedisafeSecret2026! and PharmacyPass123!
old_auto_step3 = '''setPassphrase("VivaDemoPass2026!"); setPresentationPassphrase("PharmacyPass2026!"); setPharmacyAddress("0x7465C8b4C7a9068c440044222539f993bf4537A7");'''
new_auto_step3 = '''setPassphrase("MedisafeSecret2026!"); setPresentationPassphrase("PharmacyPass123!"); setPharmacyAddress("0x7465C8b4C7a9068c440044222539f993bf4537A7");'''
if old_auto_step3 in content:
    content = content.replace(old_auto_step3, new_auto_step3)
    print("1. Step 3 passphrases updated to MedisafeSecret2026! / PharmacyPass123!")
else:
    print("1. old_auto_step3 NOT found")

# 2. Align passphrase in Step 4 Auto-fill:
old_auto_step4 = '''passphrase: "PharmacyPass2026!"'''
new_auto_step4 = '''passphrase: "PharmacyPass123!"'''
if old_auto_step4 in content:
    content = content.replace(old_auto_step4, new_auto_step4)
    print("2. Step 4 passphrase updated to PharmacyPass123!")
else:
    print("2. old_auto_step4 NOT found")

# 3. Enhance file input in Pharmacy Desk with validation & warning:
old_pharm_input = '''<input ref={dispenseFileInput} id="dispense-credential" type="file" accept="application/json,.json" onChange={(e) => setDispenseForm({ ...dispenseForm, credentialFile: e.target.files?.[0] || null })} required/>'''
new_pharm_input = '''<input ref={dispenseFileInput} id="dispense-credential" type="file" accept="application/json,.json" onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.name.toLowerCase().includes("patient-preparation")) {
                    setNotice({ type: "error", message: "⚠️ WRONG FILE SELECTED: You selected '" + file.name + "'. In the Pharmacy Desk, you must upload 'medisafe-pharmacy-presentation.json' (downloaded in Step 3)." });
                  } else {
                    setNotice(null);
                  }
                  setDispenseForm({ ...dispenseForm, credentialFile: file });
                }} required/>'''
if old_pharm_input in content:
    content = content.replace(old_pharm_input, new_pharm_input)
    print("3. Pharmacy Desk file validation added!")
else:
    print("3. old_pharm_input NOT found")

# 4. Enhance submitDispense error handling for wrong file:
old_submit_dispense = '''      const serialized = await readCredentialFile(dispenseForm.credentialFile);
      const credential = await decryptPatientCredential(serialized, dispenseForm.passphrase);'''
new_submit_dispense = '''      if (dispenseForm.credentialFile?.name?.toLowerCase()?.includes("patient-preparation")) {
        throw new Error("Wrong file selected! You uploaded '" + dispenseForm.credentialFile.name + "' (the preparation file from Step 1). Please upload 'medisafe-pharmacy-presentation.json' (the pharmacy file from Step 3).");
      }
      const serialized = await readCredentialFile(dispenseForm.credentialFile);
      let credential;
      try {
        credential = await decryptPatientCredential(serialized, dispenseForm.passphrase);
      } catch (decErr) {
        throw new Error("Could not decrypt with passphrase '" + dispenseForm.passphrase + "'. Make sure you selected 'medisafe-pharmacy-presentation.json' (from Step 3) and used the Pharmacy presentation passphrase (PharmacyPass123!).");
      }'''
if old_submit_dispense in content:
    content = content.replace(old_submit_dispense, new_submit_dispense)
    print("4. submitDispense error handling enhanced!")
else:
    print("4. old_submit_dispense NOT found")

# 5. Also enhance PatientDashboard file input:
old_pat_input = '''<input ref={credentialInput} id="patient-credential-file" type="file" accept="application/json,.json" onChange={(event) => setCredentialFile(event.target.files?.[0] || null)} required/>'''
new_pat_input = '''<input ref={credentialInput} id="patient-credential-file" type="file" accept="application/json,.json" onChange={(event) => {
                const file = event.target.files?.[0] || null;
                if (file && file.name.toLowerCase().includes("pharmacy-presentation")) {
                  setNotice({ type: "error", message: "⚠️ WRONG FILE SELECTED: You selected '" + file.name + "'. Here you must upload 'medisafe-patient-preparation.json' (from Step 1)." });
                } else {
                  setNotice(null);
                }
                setCredentialFile(file);
              }} required/>'''
if old_pat_input in content:
    content = content.replace(old_pat_input, new_pat_input)
    print("5. PatientDashboard file validation added!")
else:
    print("5. old_pat_input NOT found")

with open('frontend/src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("All done!")
