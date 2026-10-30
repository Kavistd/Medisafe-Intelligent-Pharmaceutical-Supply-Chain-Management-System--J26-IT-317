const { expect } = require("chai");
// Ajv is already present in the project's locked dependency tree.
const Ajv = require("ajv");
const schema = require("../../../shared/schemas/medicineBatch.schema.json");
const hre = require("hardhat");

describe("Component 1: shared medicine batch schema", function () {
  const validate = new Ajv({ allErrors: true }).compile(schema);
  function valid() {
    return { batchId: "BATCH-001", medicineId: "MED-001", name: "Amoxicillin", category: "Antibiotic",
      dosageForm: "Capsule", strength: "500 mg", manufacturerName: "Example", indication: "Infection",
      classification: "Prescription", quantity: 100, manufacturedAt: 1700000000, expiresAt: 1900000000,
      documentReference: "ipfs://document-reference", certificateReference: "ipfs://certificate-reference" };
  }

  it("accepts the full registration tuple without changing string identifiers", function () {
    const batch = valid();
    expect(validate(batch), JSON.stringify(validate.errors)).to.equal(true);
    expect(batch.batchId).to.equal("BATCH-001");
  });

  it("matches the contract's BatchData field names and required fields", async function () {
    const artifact = await hre.artifacts.readArtifact("MedicineTraceability");
    const fields = artifact.abi.find(item => item.name === "registerBatch").inputs[0].components.map(item => item.name);
    expect(Object.keys(schema.properties)).to.deep.equal(fields);
    expect(schema.required).to.deep.equal(fields);
  });

  for (const field of schema.required) it(`rejects missing ${field}`, function () {
    const batch = valid(); delete batch[field];
    expect(validate(batch)).to.equal(false);
  });

  it("rejects null, non-object payloads and caller-supplied custody or patient fields", function () {
    for (const value of [null, [], "batch", { ...valid(), owner: "0x123" }, { ...valid(), recalled: false }, { ...valid(), patientId: "private" }])
      expect(validate(value)).to.equal(false);
  });

  it("rejects blank, control-only and non-string text values", function () {
    for (const field of Object.keys(valid()).filter(key => typeof valid()[key] === "string"))
      for (const value of ["", " \t\r\n", "\u0000", 123, null]) expect(validate({ ...valid(), [field]: value })).to.equal(false);
  });

  it("rejects zero, negative, fractional, unsafe and coerced numeric values", function () {
    for (const field of ["quantity", "manufacturedAt", "expiresAt"])
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", null])
        expect(validate({ ...valid(), [field]: value })).to.equal(false);
  });

  it("documents that cross-field, current-time and full CID checks require semantic validation", function () {
    // Draft-07 validates structure; it does not compare sibling values or chain time.
    expect(validate({ ...valid(), expiresAt: 1 })).to.equal(true);
    expect(schema.$comment).to.include("Contract validation remains authoritative");
  });
});
