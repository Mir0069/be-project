import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import './index.css'

import QueryProvider from "@/providers/QueryProvider";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "sonner";
import { Check, X } from "lucide-react";

const brandedIcon = (tone: "success" | "error", icon: React.ReactNode) => (
  <span
    className={`flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm ${
      tone === "success" ? "bg-emerald-500" : "bg-red-500"
    }`}
  >
    {icon}
  </span>
);

ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <QueryProvider>
      <AuthProvider>
        <App />

        <Toaster
          position="top-right"
          closeButton
          gap={10}
          offset={18}
          icons={{
            success: brandedIcon("success", <Check size={13} strokeWidth={3} />),
            error: brandedIcon("error", <X size={13} strokeWidth={3} />),
          }}
          toastOptions={{
            classNames: {
              toast:
                "!rounded-xl !border !border-gray-100 !bg-white !text-gray-800 !shadow-xl !shadow-black/5 animate-fade-in",
              title: "!text-sm !font-semibold !text-gray-900",
              description: "!text-sm !text-gray-500",
              closeButton:
                "!border-gray-200 !bg-white !text-gray-400 hover:!text-gray-700 hover:!border-gray-300",
            },
          }}
        />
      </AuthProvider>
    </QueryProvider>
  </React.StrictMode>
);