import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { describeActivity, formatTime } from "../utils/format";

const toDraft = (t) => ({
  title: t.title,
  description: t.description || "",
  priority: t.priority,
  dueDate: t.dueDate ? t.dueDate.slice(0, 10) : "",
  assignedTo: t.assignedTo || "",
});

export default function TaskDetails({
  task,
  columnName,
  members,
  canDelete,
  onClose,
  onSaved,
  onDeleted,
  notify,
}) {
  const [draft, setDraft] = useState(null);
  const [baseVersion, setBaseVersion] = useState(null); // version my edits are based on
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const lastId = useRef(null);

  // Load the task into the form. If it changes remotely and I have no unsaved edits, refresh silently.
  useEffect(() => {
    if (lastId.current !== task.id || !dirty) {
      lastId.current = task.id;
      setDraft(toDraft(task));
      setBaseVersion(task.version);
      setDirty(false);
    }
  }, [task, dirty]);

  useEffect(() => {
    let alive = true;
    api
      .get(`/activity?entityId=${task.id}&limit=20`)
      .then(({ data }) => alive && setHistory(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [task.id, task.version]);

  if (!draft) return null;

  // Someone else saved a newer version while I was editing
  const conflict = dirty && baseVersion !== task.version;

  const set = (key) => (e) => {
    setDraft({ ...draft, [key]: e.target.value });
    setDirty(true);
  };

  const loadLatest = () => {
    setDraft(toDraft(task));
    setBaseVersion(task.version);
    setDirty(false);
  };
  const keepMine = () => setBaseVersion(task.version); // my next save overwrites theirs

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put(`/tasks/${task.id}`, {
        version: baseVersion,
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        assignedTo: draft.assignedTo || null,
      });
      onSaved(data);
      setDirty(false);
    } catch (err) {
      if (err.response && err.response.status === 409) {
        onSaved(err.response.data.current); // shows the conflict banner
        notify("Someone else updated this task first.");
      } else {
        notify(
          (err.response && err.response.data && err.response.data.error) ||
            "Save failed",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this task?")) return;
    try {
      await api.delete(`/tasks/${task.id}`);
      onDeleted(task.id);
    } catch (err) {
      notify(
        (err.response && err.response.data && err.response.data.error) ||
          "Delete failed",
      );
    }
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <h3>Task details</h3>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-body">
        {conflict && (
          <div className="conflict">
            <b>This task was changed by someone else.</b>
            <p>Your unsaved edits are still here. Choose what to do:</p>
            <div className="add-actions">
              <button className="btn small" onClick={loadLatest}>
                Load latest (discard mine)
              </button>
              <button className="btn small primary" onClick={keepMine}>
                Keep mine
              </button>
            </div>
          </div>
        )}

        <label>Title</label>
        <input className="input" value={draft.title} onChange={set("title")} />

        <label>Description</label>
        <textarea
          className="input"
          rows={5}
          value={draft.description}
          onChange={set("description")}
        />

        <div className="row">
          <div>
            <label>Status</label>
            <div className="static">{columnName}</div>
          </div>
          <div>
            <label>Priority</label>
            <select
              className="input"
              value={draft.priority}
              onChange={set("priority")}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label>Due date</label>
            <input
              className="input"
              type="date"
              value={draft.dueDate}
              onChange={set("dueDate")}
            />
          </div>
          <div>
            <label>Assignee</label>
            <select
              className="input"
              value={draft.assignedTo}
              onChange={set("assignedTo")}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="muted small-text">
          Created {formatTime(task.createdAt)} · Updated{" "}
          {formatTime(task.updatedAt)} · v{task.version}
        </p>

        <div className="add-actions">
          <button
            className="btn primary"
            disabled={!dirty || saving || !draft.title.trim()}
            onClick={save}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {canDelete && (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
        </div>

        <h4>History</h4>
        <ul className="activity-list">
          {history.map((l) => (
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
