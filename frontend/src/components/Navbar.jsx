import { useAuth } from "../context/AuthContext";
import PresenceIndicator from "./PresenceIndicator";

export default function Navbar({ presence }) {
  const {
    user,
    organizations,
    currentOrg,
    currentTenant,
    selectOrg,
    selectTenant,
    logout,
  } = useAuth();

  return (
    <header className="navbar">
      <div className="nav-left">
        <span className="brand">▦ Kanban</span>

        <select
          className="select"
          aria-label="Organization"
          value={currentOrg ? currentOrg.id : ""}
          onChange={(e) => selectOrg(e.target.value)}
        >
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <div className="chips" aria-label="Branches">
          {currentOrg &&
            currentOrg.tenants.map((t) => (
              <button
                key={t.id}
                className={`chip ${currentTenant && t.id === currentTenant.id ? "active" : ""}`}
                onClick={() => selectTenant(t.id)}
              >
                {t.name}
              </button>
            ))}
        </div>
      </div>

      <div className="nav-right">
        <PresenceIndicator users={presence} meId={user.id} />
        {currentTenant && (
          <span className="role-badge">
            {currentTenant.role.replace("_", " ")}
          </span>
        )}
        <span className="user-name">{user.name}</span>
        <button className="btn small" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}
