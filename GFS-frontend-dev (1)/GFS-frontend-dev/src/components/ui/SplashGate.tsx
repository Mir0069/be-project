import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import Splash from "@/components/ui/Splash";

type SplashGateProps = {
  children: ReactNode;
  minMs?: number;
};

const SplashGate = ({ children, minMs = 0 }: SplashGateProps) => {
  const [ready, setReady] = useState(minMs === 0);

  useEffect(() => {
    if (minMs > 0) {
      const timer = setTimeout(() => setReady(true), minMs);
      return () => clearTimeout(timer);
    }
  }, [minMs]);

  if (!ready) return <Splash />;

  return <>{children}</>;
};

export default SplashGate;
