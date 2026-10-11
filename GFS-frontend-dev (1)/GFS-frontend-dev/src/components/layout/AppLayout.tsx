// components/layout/AppLayout.tsx

import React from "react";
import Sidebar from "../ui/Sidebar";
import Topbar from "./Topbar";
import { useNotificationStream } from "@/features/notifications/hooks/useNotificationStream";

type AppLayoutProps = {
  children: React.ReactNode;
};

const AppLayout = ({
  children,
}: AppLayoutProps) => {
  useNotificationStream();

  return (

    <div className="h-screen flex bg-[#E9EBF2] overflow-hidden">
      {/* Common Sidebar  */}
      <div className="h-screen shrink-0">
        <Sidebar />
      </div>

      {/* Right side: topbar + page content */}
      <div className="flex-1 h-screen flex flex-col overflow-hidden">
        {/* <Topbar /> */}
        <main className="flex-1 overflow-y-auto no-scrollbar p-6">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;