import { initials } from "../utils/format";

export default function PresenceIndicator({ users, meId }) {
  return (
    <div className="presence" title={users.map((u) => u.name).join(", ")}>
      <span className="dot" />
      <span className="presence-text">{users.length} online</span>
      <div className="avatars">
        {users.slice(0, 5).map((u) => (
          <span
            key={u.id}
            className={`avatar ${u.id === meId ? "me" : ""}`}
            title={u.id === meId ? `${u.name} (you)` : u.name}
          >
            {initials(u.name)}
          </span>
        ))}
      </div>
    </div>
  );
}
