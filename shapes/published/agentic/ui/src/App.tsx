import { useEffect } from "react";

import { AppRoutes } from "./router";
import { ToastHost } from "./overlay/toast";
import { init, dispose } from "./thread/store";

export function App() {
  useEffect(() => {
    void init();
    return dispose;
  }, []);

  return (
    <>
      <AppRoutes />
      <ToastHost />
    </>
  );
}
