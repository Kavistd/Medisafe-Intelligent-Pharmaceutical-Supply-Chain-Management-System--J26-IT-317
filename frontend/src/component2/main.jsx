import React from "react";
import { createRoot } from "react-dom/client";
import RiskScoringApp from "./RiskScoringApp.jsx";
import "./risk-scoring.css";
import "./risk-responsive.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode><RiskScoringApp /></React.StrictMode>,
);
