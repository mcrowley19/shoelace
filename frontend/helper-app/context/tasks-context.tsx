import React, { createContext, useContext, useState } from "react";
import { PREDEFINED_TASKS } from "@/data/tasks";

export interface Task {
  id: string;
  text: string;
  prompt: string;
  category: string;
  completed: boolean;
  time?: string;
  setup?: string[];
}

export type { PredefinedTask } from "@/data/tasks";

const TasksContext = createContext<TasksContextType | null>(null);

interface TasksContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, "id">) => void;
  updateTask: (id: string, updates: Partial<Pick<Task, "time">>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  getTask: (id: string) => Task | undefined;
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(
    PREDEFINED_TASKS.map((p, i) => ({
      id: String(i + 1),
      text: p.text,
      prompt: p.prompt,
      category: p.category,
      completed: false,
      setup: p.setup,
    })),
  );

  const addTask = (task: Omit<Task, "id">) => {
    setTasks((prev) => [...prev, { ...task, id: Date.now().toString() }]);
  };

  const updateTask = (id: string, updates: Partial<Pick<Task, "time">>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
  };

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    );
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const getTask = (id: string) => tasks.find((t) => t.id === id);

  return (
    <TasksContext.Provider
      value={{ tasks, addTask, updateTask, toggleTask, deleteTask, getTask }}
    >
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks() {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks must be used within TasksProvider");
  return ctx;
}
