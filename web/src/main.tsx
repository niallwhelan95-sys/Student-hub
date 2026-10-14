import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { App } from "./App";
import { queryClient } from "./lib/queries";
import { applyPrefs } from "./lib/prefs";
import { ToastProvider } from "./components/toast";

applyPrefs();
if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
