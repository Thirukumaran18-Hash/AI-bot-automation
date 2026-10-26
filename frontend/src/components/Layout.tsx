import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "./ui";
import { Chatbot } from "./Chatbot";
import { Icon, LogoMark, type IconName } from "./Icon";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  roles: string[];
  end?: boolean;
  badge?: "reviews";
}

const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { to: "/", label: "Dashboard", icon: "dashboard", roles: ["admin", "mentor", "intern"], end: true },
      { to: "/interns", label: "Interns", icon: "users", roles: ["admin", "mentor"] },
      { to: "/tasks", label: "Tasks", icon: "clipboard", roles: ["admin", "mentor"] },
      { to: "/assignments", label: "Assignments", icon: "layers", roles: ["admin", "mentor"] },
      { to: "/assignments", label: "My tasks", icon: "target", roles: ["intern"] },
      { to: "/reviews", label: "Review queue", icon: "check-circle", roles: ["admin", "mentor"], badge: "reviews" },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/meetings", label: "Meetings", icon: "calendar", roles: ["admin", "mentor", "intern"] },
      { to: "/activity", label: "Activity & email", icon: "activity", roles: ["admin", "mentor", "intern"] },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  mentor: "Mentor",
  intern: "Intern",
};

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/assignments/")) return "Assignment detail";
  if (pathname.startsWith("/interns")) return "Interns";
  if (pathname.startsWith("/tasks")) return "Tasks";
  if (pathname.startsWith("/assignments")) return "Assignments";
  if (pathname.startsWith("/reviews")) return "Review queue";
  if (pathname.startsWith("/meetings")) return "Meetings";
  if (pathname.startsWith("/activity")) return "Activity & email";
  return "Dashboard";
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user || user.role === "intern") return;
    let active = true;
    const load = () => {
      api
        .get<{ pending: number }>("/api/reviews/pending-count")
        .then((data) => {
          if (active) setPendingReviews(data.pending);
        })
        .catch(() => undefined);
    };
    load();
    const interval = window.setInterval(load, 60000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user, location.pathname]);

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <LogoMark size={38} />
          <div>
            <strong>InternFlow</strong>
            <span>AI internship ops</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => item.roles.includes(user.role));
            if (!items.length) return null;
            return (
              <div className="nav-section" key={section.title}>
                <div className="nav-section-title">{section.title}</div>
                {items.map((item) => (
                  <NavLink
                    key={`${item.to}-${item.label}`}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                  >
                    <span className="nav-icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span>{item.label}</span>
                    {item.badge === "reviews" && pendingReviews > 0 && (
                      <span className="nav-badge">{pendingReviews}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <Avatar name={user.name} size={38} />
            <div className="sidebar-user-info">
              <strong>{user.name}</strong>
              <span>{ROLE_LABEL[user.role] || user.role}</span>
            </div>
            <button className="sidebar-logout" onClick={handleLogout} aria-label="Sign out">
              <Icon name="logout" size={17} />
            </button>
          </div>
          <div className="sidebar-note">
            <Icon name="shield" size={14} />
            <span>Demo workspace · local data</span>
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button topbar-menu"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle navigation"
            >
              <Icon name="menu" size={19} />
            </button>
            <div>
              <div className="topbar-eyebrow">InternFlow AI</div>
              <h1>{pageTitle(location.pathname)}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <span className={`role-chip role-${user.role}`}>{ROLE_LABEL[user.role] || user.role}</span>
            <div className="topbar-user">
              <Avatar name={user.name} size={34} />
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
            </div>
            <button className="icon-button" onClick={handleLogout} aria-label="Sign out" title="Sign out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>

      <Chatbot />
    </div>
  );
}
