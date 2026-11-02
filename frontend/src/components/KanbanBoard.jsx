import { useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import BoardColumn from "./BoardColumn";
import { TaskCardView } from "./TaskCard";

export default function KanbanBoard({
  columns,
  setColumns,
  members,
  onMove,
  onResync,
  onOpenTask,
  onAddTask,
}) {
  const [activeTask, setActiveTask] = useState(null);
  const startRef = useRef(null); // where the drag started (column + index)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );

  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));

  function handleDragStart({ active }) {
    for (const col of columns) {
      const index = col.tasks.findIndex((t) => t.id === active.id);
      if (index !== -1) {
        setActiveTask(col.tasks[index]);
        startRef.current = { colId: col.id, index };
        return;
      }
    }
  }

  // Live preview while dragging across columns (optimistic, local only)
  function handleDragOver({ active, over }) {
    if (!over) return;
    setColumns((prev) => {
      const from = prev.find((c) => c.tasks.some((t) => t.id === active.id));
      const to =
        prev.find((c) => c.id === over.id) ||
        prev.find((c) => c.tasks.some((t) => t.id === over.id));
      if (!from || !to || from.id === to.id) return prev;

      const task = from.tasks.find((t) => t.id === active.id);
      const overIndex = to.tasks.findIndex((t) => t.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : to.tasks.length;

      return prev.map((c) => {
        if (c.id === from.id)
          return { ...c, tasks: c.tasks.filter((t) => t.id !== active.id) };
        if (c.id === to.id) {
          const tasks = [...c.tasks];
          tasks.splice(insertAt, 0, { ...task, columnId: c.id });
          return { ...c, tasks };
        }
        return c;
      });
    });
  }

  // Drop: the UI is already updated, now tell the server which neighbours it sits between
  function handleDragEnd({ active, over }) {
    setActiveTask(null);
    const start = startRef.current;
    startRef.current = null;

    if (!over || !start) {
      onResync(); // dropped outside: restore the server's state
      return;
    }

    const col = columns.find((c) => c.tasks.some((t) => t.id === active.id));
    if (!col) return;

    let tasks = col.tasks;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const overIndex = tasks.findIndex((t) => t.id === over.id);
    if (overIndex !== -1 && overIndex !== oldIndex) {
      tasks = arrayMove(tasks, oldIndex, overIndex);
      setColumns(columns.map((c) => (c.id === col.id ? { ...c, tasks } : c)));
    }

    const index = tasks.findIndex((t) => t.id === active.id);
    if (col.id === start.colId && index === start.index) return; // dropped where it started

    const prev = index > 0 ? tasks[index - 1].id : null;
    const next = index < tasks.length - 1 ? tasks[index + 1].id : null;
    onMove(tasks[index], col.id, prev, next);
  }

  function handleDragCancel() {
    setActiveTask(null);
    startRef.current = null;
    onResync();
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="columns">
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            memberMap={memberMap}
            onOpenTask={onOpenTask}
            onAddTask={onAddTask}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCardView
            task={activeTask}
            assignee={memberMap[activeTask.assignedTo]}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
