import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("../../outputs/ai-use-record/", import.meta.url).pathname;
const outputPath = `${outputDir}MEDISAFE_CHAIN_Component2_AI_Use_Record.xlsx`;
const previewPath = `${outputDir}MEDISAFE_CHAIN_Component2_AI_Use_Record_preview.png`;

const records = [
  [1, new Date("2026-10-12T00:00:00"), "Dataset collection and integration", "Planning and review", "Discussed how to organize the Component 2 medicine-risk dataset and connect its fields to the project structure.", "Suggested dataset organization, field mapping, validation considerations and implementation sequence.", "Selected the dataset, reviewed its fields, placed it in the project and confirmed that the data matched the Component 2 requirements.", "Dataset stored in the Component 2 data directory and reviewed during preprocessing.", "Used after student review"],
  [2, new Date("2026-10-12T00:00:00"), "Data cleaning and feature engineering", "Code assistance", "Requested help structuring cleaning, encoding and feature-engineering modules for medicine risk scoring.", "Suggested modular preprocessing code, validation checks and candidate model features.", "Reviewed the transformation rules, chose the final features and ran the preprocessing pipeline against the project dataset.", "Cleaning and feature-engineering modules completed; outputs checked during model training.", "Used with modifications"],
  [3, new Date("2026-10-12T00:00:00"), "Random Forest model", "Code assistance", "Requested implementation guidance for training and evaluating a Random Forest risk model.", "Suggested training structure, evaluation metrics and reproducible model settings.", "Ran training, reviewed performance, retained the suitable configuration and recorded the model metrics.", "Random Forest training script and metrics created.", "Used with verification"],
  [4, new Date("2026-10-12T00:00:00"), "Data and API contracts", "Documentation support", "Requested help defining the medicine-batch and risk-score data exchanged between components.", "Suggested schemas, field descriptions and contract boundaries.", "Confirmed the identifiers and fields with the project architecture and maintained the shared contracts in the repository.", "Shared schemas and Component 1–2 / Component 2–4 contract documents created.", "Used after review"],
  [5, new Date("2026-10-13T00:00:00"), "XGBoost model", "Code assistance", "Requested guidance for implementing and evaluating an XGBoost risk model using the same feature pipeline.", "Suggested training flow, evaluation output and compatibility with the existing preprocessing modules.", "Executed training, reviewed the results and compared them with the Random Forest model.", "XGBoost training script and metrics created.", "Used with verification"],
  [6, new Date("2026-10-13T00:00:00"), "Model evaluation and selection", "Analysis support", "Requested help comparing the trained models and selecting the best model consistently.", "Suggested comparable metrics, selection logic and documentation structure.", "Reviewed the reported metrics, selected the final model and retained the evaluation evidence.", "Model comparison, selection record and evaluation documentation completed.", "Used as decision support"],
  [7, new Date("2026-10-13T00:00:00"), "SHAP explainability", "Code and explanation support", "Requested guidance for adding SHAP explanations to Component 2 predictions.", "Suggested explainer structure and a readable feature-contribution response format.", "Integrated the explainer, checked representative predictions and decided which explanation fields to expose through the API.", "SHAP explanation modules and notebook completed.", "Used with modifications"],
  [8, new Date("2026-10-13T00:00:00"), "Risk-scoring API and validation", "Code assistance", "Requested support for creating the risk-scoring API, request validation and API tests.", "Suggested route structure, validation rules, error handling and test cases.", "Reviewed endpoint behavior, ran the test suite and corrected integration issues in the local environment.", "Runnable Component 2 API and automated validation tests completed.", "Used with verification"],
  [9, new Date("2026-10-13T00:00:00"), "MedicineRiskRegistry contract", "Code and testing support", "Requested help implementing an on-chain registry for medicine-batch risk scores.", "Suggested access control, score storage, safety checks, events and contract tests.", "Reviewed the Solidity logic, aligned it with the 0–100 policy, ran Hardhat tests and controlled local deployment.", "Risk Registry contract, deployment workflow and contract tests completed.", "Used with modifications"],
  [10, new Date("2026-10-13T00:00:00"), "Model evaluation documentation", "Documentation support", "Requested help summarizing evaluation results and explaining why the selected model was retained.", "Suggested a structured evaluation report and clear descriptions of metrics and limitations.", "Checked the reported values against generated metrics and edited the documentation for the project context.", "Component 2 model-evaluation document completed.", "Used after review"],
  [11, new Date("2026-10-14T00:00:00"), "Deployment and Web3 configuration", "Debugging and code assistance", "Requested help creating a safe local deployment workflow and central Web3 configuration.", "Suggested deployment guards, network checks, address validation, ABI export and readiness checks.", "Ran the deployment tests, selected the local network settings and reviewed configuration changes before PR submission.", "Risk Registry deployment, shared ABI and blockchain readiness workflow completed.", "Used with verification"],
  [12, new Date("2026-10-15T00:00:00"), "Component 1 integration", "Integration assistance", "Requested help reading traceability batches and mapping them into Component 2 model inputs.", "Suggested the blockchain client, field mapper, error handling and integration tests.", "Confirmed the approved fields, ran mapper/client tests and reviewed compatibility with the Component 1 contract.", "Component 1 batch reading, mapping and assessment endpoint completed.", "Used with modifications"],
  [13, new Date("2026-10-16T00:00:00"), "Component 2 to Component 4 integration", "Integration and testing assistance", "Requested help publishing risk records and enforcing them during prescription dispensing.", "Suggested unsigned transaction construction, confirmation checks, fail-closed behavior, shared ABI handling and integration tests.", "Reviewed the policy boundaries, resolved merge conflicts, ran Python and Hardhat tests and coordinated interface changes with Component 4.", "Publishing API, transaction confirmation and Component 2–4 contract integration completed.", "Used with verification"],
  [14, new Date("2026-10-18T00:00:00"), "Cross-component status review", "Repository analysis", "Requested an evidence-based review of Components 1, 3 and 4 and their integration status.", "Summarized repository modules, missing layers, test results and integration risks.", "Reviewed the findings, contacted Component 4 and used the report to prioritize presentation work.", "Current component status and demonstration blockers identified.", "Used for planning"],
  [15, new Date("2026-10-19T00:00:00"), "Local blockchain demonstration", "Deployment guidance and verification", "Requested guidance for starting Hardhat, deploying Component 2 and validating the active local contract.", "Provided deployment steps and checks for chain ID, bytecode, address configuration and roles.", "Started the node, executed the deployment and supplied the live output. The student retained control of the terminal and local accounts.", "MedicineRiskRegistry deployed on chain 31337; admin and oracle roles verified.", "Used with manual execution"],
  [16, new Date("2026-10-19T00:00:00"), "Testing, Git and PR preparation", "Review and workflow assistance", "Requested help organizing commits, running tests and preparing a pull-request description.", "Suggested focused commit groups, identified stale integration artifacts and drafted the PR summary.", "Approved the changes, reviewed test output, raised the PR and merged it through the team repository workflow.", "Four focused commits; 66 Python tests and 48 contract tests passed before the PR.", "Used after review"],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("AI Use Register");
sheet.showGridLines = false;
sheet.tabColor = "#244B5A";

sheet.getRange("A2:I2").merge();
sheet.getRange("A2").values = [["MEDISAFE CHAIN – Component 2 AI Use Record"]];
sheet.getRange("A2").format.font = { name: "Arial", size: 16, bold: true, color: "#16313B" };
sheet.getRange("A2").format.rowHeight = 28;

sheet.getRange("A3:I3").merge();
sheet.getRange("A3").values = [["Project period: 12–19 October 2026 | Component: AI-based medicine risk scoring"]];
sheet.getRange("A3").format.font = { name: "Arial", size: 10, italic: true, color: "#53666D" };

sheet.getRange("A4:I4").merge();
sheet.getRange("A4").values = [["Scope note: This is a grouped activity record reconstructed from project tasks and repository history. Prompt summaries are paraphrased; exact prompt wording and timestamps were not reconstructed."]];
sheet.getRange("A4").format = {
  fill: "#FFF4D6",
  font: { name: "Arial", size: 10, color: "#6E5312" },
  wrapText: true,
  verticalAlignment: "center",
  borders: { preset: "outside", style: "thin", color: "#E7C86A" },
};
sheet.getRange("A4:I4").format.rowHeight = 40;

sheet.getRange("A6:B6").values = [["Entries", null]];
sheet.getRange("B6").formulas = [["=COUNTA(A10:A100)"]];
sheet.getRange("D6:E6").values = [["Period covered", "12–19 Oct 2026"]];
sheet.getRange("G6:H6").values = [["Student verification", "Tests, reviews and deployment"]];
for (const rangeName of ["A6:B6", "D6:E6", "G6:H6"]) {
  const range = sheet.getRange(rangeName);
  range.format.borders = { preset: "outside", style: "thin", color: "#C9D5D9" };
  range.format.verticalAlignment = "center";
}
for (const cell of ["A6", "D6", "G6"]) {
  sheet.getRange(cell).format = { fill: "#244B5A", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" } };
}
for (const cell of ["B6", "E6", "H6"]) {
  sheet.getRange(cell).format = { fill: "#EDF3F5", font: { name: "Arial", size: 10, bold: true, color: "#16313B" } };
}

const headers = [["ID", "Date", "Project stage", "AI use category", "Prompt / request summary", "AI assistance", "Student work and decisions", "Verification / evidence", "Outcome"]];
sheet.getRange("A9:I9").values = headers;
sheet.getRange(`A10:I${9 + records.length}`).values = records;
const table = sheet.tables.add(`A9:I${9 + records.length}`, true, "AIUseRegister");
table.style = "TableStyleMedium2";
table.showFilterButton = true;

sheet.getRange(`A9:I${9 + records.length}`).format.font = { name: "Arial", size: 10, color: "#1E2D33" };
sheet.getRange("A9:I9").format = {
  fill: "#244B5A",
  font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
sheet.getRange("A9:I9").format.rowHeight = 34;

const dataRange = sheet.getRange(`A10:I${9 + records.length}`);
dataRange.format.verticalAlignment = "top";
dataRange.format.wrapText = true;
dataRange.format.borders = { preset: "inside", style: "thin", color: "#E1E8EA" };
sheet.getRange(`A10:A${9 + records.length}`).format.horizontalAlignment = "center";
sheet.getRange(`B10:B${9 + records.length}`).setNumberFormat("dd-mmm-yyyy");
sheet.getRange(`B10:B${9 + records.length}`).format.horizontalAlignment = "center";

sheet.getRange("A:A").format.columnWidth = 6;
sheet.getRange("B:B").format.columnWidth = 13;
sheet.getRange("C:C").format.columnWidth = 24;
sheet.getRange("D:D").format.columnWidth = 22;
sheet.getRange("E:E").format.columnWidth = 40;
sheet.getRange("F:F").format.columnWidth = 42;
sheet.getRange("G:G").format.columnWidth = 48;
sheet.getRange("H:H").format.columnWidth = 43;
sheet.getRange("I:I").format.columnWidth = 23;
sheet.getRange(`A10:I${9 + records.length}`).format.rowHeight = 66;

sheet.freezePanes.freezeRows(9);
sheet.freezePanes.freezeColumns(2);

workbook.recalculate();

const tableCheck = await workbook.inspect({
  kind: "table",
  range: `AI Use Register!A1:I${9 + records.length}`,
  include: "values,formulas",
  tableMaxRows: 30,
  tableMaxCols: 9,
  maxChars: 16000,
});
console.log(tableCheck.ndjson);

const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errorCheck.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: "AI Use Register", range: `A1:I${9 + records.length}`, scale: 1 });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, previewPath }));
