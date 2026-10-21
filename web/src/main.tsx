import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

// Web fonts: a separate stylesheet so the @font-face rules never block the first paint.
void import("./fonts.css");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
