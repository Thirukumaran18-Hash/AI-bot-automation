import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { EmptyState } from "./components/ui";
import { Activity } from "./pages/Activity";
import { AssignmentDetail } from "./pages/AssignmentDetail";
import { Assignments } from "./pages/Assignments";
import { Dashboard } from "./pages/Dashboard";
import { Interns } from "./pages/Interns";
import { Login } from "./pages/Login";
import { Meetings } from "./pages/Meetings";
import { Reviews } from "./pages/Reviews";
import { Tasks } from "./pages/Tasks";
import type { Role } from "./types";

function FullPageLoader() {
  return (
    <div className="full-loader">
      <span className="spinner" />
      <strong>Loading InternFlow…</strong>
      <span>Restoring your workspace</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="page-stack">
      <div className="card">
        <EmptyState
          icon="search"
          title="Page not found"
          message="The page you were looking for does not exist or has moved."
          action={<Link className="btn btn-primary" to="/">Back to dashboard</Link>}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route
          path="interns"
          element={
            <RoleGate roles={["admin", "mentor"]}>
              <Interns />
            </RoleGate>
          }
        />
        <Route
          path="tasks"
          element={
            <RoleGate roles={["admin", "mentor"]}>
              <Tasks />
            </RoleGate>
          }
        />
        <Route path="assignments" element={<Assignments />} />
        <Route path="assignments/:assignmentId" element={<AssignmentDetail />} />
        <Route
          path="reviews"
          element={
            <RoleGate roles={["admin", "mentor"]}>
              <Reviews />
            </RoleGate>
          }
        />
        <Route path="meetings" element={<Meetings />} />
        <Route path="activity" element={<Activity />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
