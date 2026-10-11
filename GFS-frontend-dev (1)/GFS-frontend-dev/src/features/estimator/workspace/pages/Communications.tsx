// pages/estimator/workspace/tabs/Communications.tsx
// Layout for the Communications tab — bottom sub-tab nav + nested outlet.

import { NavLink, Outlet, useParams } from "react-router-dom";
import { Mail, MessageSquare, Phone } from "lucide-react";

const SUB_TABS = [
  { path: "outlook", label: "Outlook", icon: <Mail size={16} className="text-blue-500" /> },
  { path: "teams", label: "Teams", icon: <MessageSquare size={16} className="text-indigo-500" /> },
  { path: "calls", label: "Call Records", icon: <Phone size={16} className="text-gray-700" /> },
];

const Communications = () => {
  const { projectId } = useParams();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <Outlet />
      </div>

      {/* Bottom sub-tabs */}
      <nav className="-mx-6 -mb-6 mt-4 bg-white border-t border-gray-200 grid grid-cols-3">
        {SUB_TABS.map((t) => (
          <NavLink
            key={t.path}
            to={`/estimator/projects/${projectId}/communications/${t.path}`}
            className={({ isActive }) =>
              `flex items-center justify-center gap-2 py-3 text-sm font-medium transition ${isActive
                ? "bg-blue-50 text-gray-900"
                : "text-gray-600 hover:bg-gray-50"
              }`
            }
          >
            {t.icon}
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

export default Communications;
