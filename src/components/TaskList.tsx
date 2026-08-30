"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";

export function TaskList() {
  const tasks = useQuery(api.tasks.list);
  const addTask = useMutation(api.tasks.add);
  const toggleTask = useMutation(api.tasks.toggle);
  const removeTask = useMutation(api.tasks.remove);
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();

    if (!cleanTitle) return;

    setIsSaving(true);
    try {
      await addTask({ title: cleanTitle });
      setTitle("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="board">
      <form onSubmit={handleSubmit} className="task-form">
        <label htmlFor="task-title">New classroom task</label>
        <div className="input-row">
          <input
            id="task-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Prepare the fractions quiz"
            maxLength={120}
            autoComplete="off"
          />
          <button type="submit" disabled={isSaving || !title.trim()}>
            {isSaving ? "Adding…" : "Add task"}
          </button>
        </div>
      </form>

      <div className="list-heading">
        <h2>Today&apos;s board</h2>
        <span>{tasks?.length ?? 0} tasks</span>
      </div>

      {tasks === undefined ? (
        <p className="empty">Loading the board…</p>
      ) : tasks.length === 0 ? (
        <p className="empty">Nothing here yet. Add the first task above.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task._id} className={task.completed ? "completed" : ""}>
              <button
                className="check-button"
                onClick={() => void toggleTask({ id: task._id })}
                aria-label={task.completed ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                aria-pressed={task.completed}
              >
                <span aria-hidden="true">{task.completed ? "✓" : ""}</span>
              </button>
              <span className="task-title">{task.title}</span>
              <button
                className="remove-button"
                onClick={() => void removeTask({ id: task._id })}
                aria-label={`Delete ${task.title}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
