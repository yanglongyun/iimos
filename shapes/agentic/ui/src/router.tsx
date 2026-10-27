import { Link, Outlet, Route, Routes } from "react-router";
import { Sidebar } from "./shell/Sidebar";
import { Settings } from "./shell/Settings";
import { ThreadView } from "./thread";

function Layout() {
  return (
    <>
      <Sidebar />
      <Outlet />
    </>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<ThreadView />} />
        <Route path="/sessions/:id" element={<ThreadView />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <main className="route-error">
              <h1>页面不存在</h1>
              <Link to="/">返回新对话</Link>
            </main>
          }
        />
      </Route>
    </Routes>
  );
}
