import "../index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { EmbedApp } from "./EmbedApp";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from embed.html");

void import("../fonts.css");

createRoot(root).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
);
