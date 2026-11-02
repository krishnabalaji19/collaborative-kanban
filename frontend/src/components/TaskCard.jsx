import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { initials } from "../utils/format";

// Plain visual card (also used inside the drag overlay)
export function TaskCardView({ task, assignee, overlay }) {
  return (
    <div className={`task-card ${overlay ? "overlay" : ""}`}>
      <div className="task-title">{task.title}</div>
      {task.description && <div className="task-desc">{task.description}</div>}
      <div className="task-meta">
        <span className={`prio prio-${task.priority}`}>{task.priority}</span>
        {task.dueDate && (
          <span className="due">
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
        {assignee && (
          <span className="avatar small" title={assignee.name}>
            {initials(assignee.name)}
          </span>
        )}
      </div>
    </div>
  );
}

// Draggable version
export default function TaskCard({ task, assignee, onOpen }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="task-wrap"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
    >
      <TaskCardView task={task} assignee={assignee} />
    </div>
  );
}
