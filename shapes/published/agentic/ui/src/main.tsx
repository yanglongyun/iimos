import { StrictMode } from "react";
import { BrowserRouter } from "react-router";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./shell/shell.css";
import "./thread/thread.css";
import "./styles/app.css";

import { App } from "./App";
import { initTheme } from "./lib/theme";

initTheme();

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
