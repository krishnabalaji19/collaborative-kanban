import { useEffect, useState } from "react";
import api from "../services/api";
import { describeActivity, formatTime } from "../utils/format";

export default function ActivityLog({ tick, onClose }) {
  const [logs, setLogs] = useState([]);

  // Re-fetch whenever something changes on the board (tick increases)
  useEffect(() => {
    let alive = true;
    api
      .get("/activity?limit=40")
      .then(({ data }) => alive && setLogs(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tick]);

  return (
    <aside className="panel">
      <div className="panel-head">
        <h3>Activity</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="panel-body">
        {logs.length === 0 && <p className="muted">No activity yet.</p>}
        <ul className="activity-list">
          {logs.map((l) => (
            <li key={l.id}>
              <span>
                <b>{l.userName}</b> {describeActivity(l)}
              </span>
              <time>{formatTime(l.createdAt)}</time>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
