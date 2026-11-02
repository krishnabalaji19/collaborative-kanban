import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import { getSocket } from "../services/socket";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import KanbanBoard from "../components/KanbanBoard";
import TaskDetails from "../components/TaskDetails";
import ActivityLog from "../components/ActivityLog";

const ADMIN_ROLES = ["ORG_ADMIN", "TENANT_ADMIN"];
const errMsg = (err, fallback) =>
  (err.response && err.response.data && err.response.data.error) || fallback;

export default function Board() {
  const { currentTenant } = useAuth();
  const tenantId = currentTenant ? currentTenant.id : null;
  const canManage = !!currentTenant && ADMIN_ROLES.includes(currentTenant.role);

  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(null);
  const [columns, setColumns] = useState([]);
  const [members, setMembers] = useState([]);
  const [presence, setPresence] = useState([]);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState(null); // 'task' | 'activity' | null
  const [selectedId, setSelectedId] = useState(null);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState("");

  // Refs let async callbacks check "am I still on the same tenant/board?"
  const boardIdRef = useRef(null);
  const tenantRef = useRef(null);
  boardIdRef.current = boardId;
  tenantRef.current = tenantId;

  const toastTimer = useRef(null);
  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);

  // ---------- data loading ----------
  const loadBoards = useCallback(async () => {
    const t = tenantRef.current;
    if (!t) return;
    try {
      const { data } = await api.get("/boards");
      if (t !== tenantRef.current) return; // tenant changed meanwhile: ignore old data
      setBoards(data);
      setBoardId((cur) =>
        cur && data.some((b) => b.id === cur)
          ? cur
          : data[0]
            ? data[0].id
            : null,
      );
    } catch (err) {
      notify(errMsg(err, "Could not load boards"));
    }
  }, [notify]);

  const loadBoard = useCallback(async () => {
    const id = boardIdRef.current;
    if (!id) return;
    try {
      const { data } = await api.get(`/boards/${id}`);
      if (id === boardIdRef.current) setColumns(data.columns);
    } catch (err) {
      if (err.response && err.response.status === 404) loadBoards();
    } finally {
      setLoading(false);
    }
  }, [loadBoards]);

  // When the tenant changes: clear everything from the old tenant, then load the new one
  useEffect(() => {
    setBoards([]);
    setBoardId(null);
    setColumns([]);
    setMembers([]);
    setPresence([]);
    setSelectedId(null);
    setPanel(null);
    if (!tenantId) return;

    loadBoards();
    api
      .get("/members")
      .then(({ data }) => tenantRef.current === tenantId && setMembers(data))
      .catch(() => {});
  }, [tenantId, loadBoards]);

  // When the board changes: load its columns and tasks
  useEffect(() => {
    setColumns([]);
    if (!boardId) return;
    setLoading(true);
    loadBoard();
  }, [boardId, loadBoard]);

  // ---------- applying changes (from my actions and from other users) ----------
  const applyTask = useCallback((task) => {
    if (task.boardId !== boardIdRef.current) return;
    setColumns((prev) => {
      const existing = prev
        .flatMap((c) => c.tasks)
        .find((t) => t.id === task.id);
      if (existing && existing.version > task.version) return prev; // stale event, ignore

      const without = prev.map((c) => ({
        ...c,
        tasks: c.tasks.filter((t) => t.id !== task.id),
      }));
      return without.map((c) => {
        if (c.id !== task.columnId) return c;
        const tasks = [...c.tasks];
        const idx = tasks.findIndex((t) => t.position > task.position);
        tasks.splice(idx === -1 ? tasks.length : idx, 0, task);
        return { ...c, tasks };
      });
    });
    setTick((n) => n + 1);
  }, []);

  const removeTask = useCallback((taskId) => {
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        tasks: c.tasks.filter((t) => t.id !== taskId),
      })),
    );
    setTick((n) => n + 1);
  }, []);

  // ---------- real-time ----------
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !tenantId) return undefined;

    const join = () =>
      socket.emit("tenant:join", { tenantId }, (res) => {
        if (res && res.ok) setPresence(res.users);
        else notify((res && res.error) || "Could not join live updates");
      });

    // After a (re)connect: rejoin the room and reload, because events may have been missed
    const onConnect = () => {
      setConnected(true);
      join();
      loadBoards();
      loadBoard();
    };
    const onDisconnect = () => setConnected(false);
    const onTask = ({ task }) => applyTask(task);
    const onDeleted = ({ taskId }) => removeTask(taskId);
    const onBoard = () => {
      loadBoards();
      loadBoard();
      setTick((n) => n + 1);
    };
    const onPresence = ({ users }) => setPresence(users);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("task:created", onTask);
    socket.on("task:updated", onTask);
    socket.on("task:moved", onTask);
    socket.on("task:deleted", onDeleted);
    socket.on("board:updated", onBoard);
    socket.on("presence:update", onPresence);

    if (socket.connected) join();

    return () => {
      socket.emit("tenant:leave");
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("task:created", onTask);
      socket.off("task:updated", onTask);
      socket.off("task:moved", onTask);
      socket.off("task:deleted", onDeleted);
      socket.off("board:updated", onBoard);
      socket.off("presence:update", onPresence);
    };
  }, [tenantId, applyTask, removeTask, loadBoards, loadBoard, notify]);

  // ---------- actions ----------
  // Optimistic: the card has already moved on screen. If the server rejects it, we reload.
  const handleMove = useCallback(
    async (task, columnId, prevTaskId, nextTaskId) => {
      try {
        const { data } = await api.patch(`/tasks/${task.id}/move`, {
          version: task.version,
          columnId,
          prevTaskId,
          nextTaskId,
        });
        applyTask(data);
      } catch (err) {
        const conflict = err.response && err.response.status === 409;
        notify(
          conflict
            ? "Someone else changed that task. Board refreshed."
            : errMsg(err, "Move failed. Board refreshed."),
        );
        loadBoard();
      }
    },
    [applyTask, loadBoard, notify],
  );

  const handleAddTask = async (columnId, title) => {
    try {
      const { data } = await api.post("/tasks", { boardId, columnId, title });
      applyTask(data);
    } catch (err) {
      notify(errMsg(err, "Could not add task"));
    }
  };

  const createBoard = async () => {
    const name = window.prompt("Board name");
    if (!name || !name.trim()) return;
    try {
      const { data } = await api.post("/boards", { name: name.trim() });
      await loadBoards();
      setBoardId(data.id);
    } catch (err) {
      notify(errMsg(err, "Could not create board"));
    }
  };

  const createColumn = async () => {
    const name = window.prompt("Column name");
    if (!name || !name.trim()) return;
    try {
      await api.post("/columns", { boardId, name: name.trim() });
      loadBoard();
    } catch (err) {
      notify(errMsg(err, "Could not create column"));
    }
  };

  const openTask = (id) => {
    setSelectedId(id);
    setPanel("task");
  };

  // ---------- render ----------
  let selectedTask = null;
  let selectedColumnName = "";
  for (const c of columns) {
    const t = c.tasks.find((x) => x.id === selectedId);
    if (t) {
      selectedTask = t;
      selectedColumnName = c.name;
    }
  }

  let content;
  if (!tenantId) {
    content = (
      <div className="empty">
        You don't have access to any branch yet. Ask an admin to add you.
      </div>
    );
  } else if (boards.length === 0) {
    content = (
      <div className="empty">
        No boards in this branch yet.{canManage ? " Create one above." : ""}
      </div>
    );
  } else if (loading && columns.length === 0) {
    content = <div className="empty">Loading board...</div>;
  } else {
    content = (
      <KanbanBoard
        columns={columns}
        setColumns={setColumns}
        members={members}
        onMove={handleMove}
        onResync={loadBoard}
        onOpenTask={openTask}
        onAddTask={handleAddTask}
      />
    );
  }

  return (
    <div className="app">
      <Navbar presence={presence} />

      {!connected && (
        <div className="banner">
          Connection lost. Reconnecting... the board will resync automatically.
        </div>
      )}

      <div className="toolbar">
        <div className="tabs">
          {boards.map((b) => (
            <button
              key={b.id}
              className={`tab ${b.id === boardId ? "active" : ""}`}
              onClick={() => setBoardId(b.id)}
            >
              {b.name}
            </button>
          ))}
          {canManage && (
            <button className="tab add" onClick={createBoard}>
              + New board
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {canManage && boardId && (
            <button className="btn small" onClick={createColumn}>
              + Column
            </button>
          )}
          <button
            className="btn small"
            onClick={() => setPanel(panel === "activity" ? null : "activity")}
          >
            Activity
          </button>
        </div>
      </div>

      <main className="board-area">{content}</main>

      {panel === "task" && selectedTask && (
        <TaskDetails
          task={selectedTask}
          columnName={selectedColumnName}
          members={members}
          canDelete={canManage}
          onClose={() => setPanel(null)}
          onSaved={applyTask}
          onDeleted={(id) => {
            removeTask(id);
            setPanel(null);
          }}
          notify={notify}
        />
      )}
      {panel === "activity" && (
        <ActivityLog tick={tick} onClose={() => setPanel(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
