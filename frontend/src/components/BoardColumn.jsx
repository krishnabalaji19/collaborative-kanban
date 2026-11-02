import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import TaskCard from "./TaskCard";

export default function BoardColumn({
  column,
  memberMap,
  onOpenTask,
  onAddTask,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    onAddTask(column.id, value);
    setTitle("");
    setAdding(false);
  };

  return (
    <section className="column">
      <div className="column-head">
        <h3>{column.name}</h3>
        <span className="count">{column.tasks.length}</span>
      </div>

      <SortableContext
        items={column.tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className={`column-body ${isOver ? "over" : ""}`}>
          {column.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              assignee={memberMap[task.assignedTo]}
              onOpen={onOpenTask}
            />
          ))}
        </div>
      </SortableContext>

      {adding ? (
        <form className="add-form" onSubmit={submit}>
          <input
            className="input"
            autoFocus
            placeholder="Task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
          />
          <div className="add-actions">
            <button className="btn primary small">Add</button>
            <button
              type="button"
              className="btn small"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="add-task" onClick={() => setAdding(true)}>
          + Add task
        </button>
      )}
    </section>
  );
}
