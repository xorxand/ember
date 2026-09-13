import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Icon, { Logo } from "./icons";
import { api, subscribe, bytes, cloud, busy, relativeTime } from "./api";
import "./styles.css";
marked.setOptions({ breaks: true, gfm: true });
function Markdown({ children }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(children || ""), {
        FORBID_TAGS: ["img", "video", "audio", "iframe", "style", "input"],
        FORBID_ATTR: ["style"],
      }),
    [children],
  );
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = e.target.closest("a");
        if (a) {
          e.preventDefault();
          try {
            const u = new URL(a.href);
            if (["http:", "https:"].includes(u.protocol))
              window.open(u.href, "_blank", "noopener,noreferrer");
          } catch {}
        }
      }}
    />
  );
}
function Button({ children, icon, className = "", ...props }) {
  return (
    <button className={`button ${className}`} {...props}>
      {icon && <Icon name={icon} size={16} />} {children}
    </button>
  );
}
function IconButton({ icon, label, ...props }) {
  return (
    <button className="icon-button" title={label} aria-label={label} {...props}>
      <Icon name={icon} />
    </button>
  );
}
function Tag({ children, green = false }) {
  return <span className={`tag ${green ? "green" : ""}`}>{children}</span>;
}
function Empty({ icon = "chat", title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [
      ...ref.current.querySelectorAll(
        "button:not(:disabled), input, select, textarea, a[href]",
      ),
    ];
    focusable()[0]?.focus();
    const key = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <IconButton icon="close" label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
function ModelSelect({
  state,
  value,
  onChange,
  disabled,
  allowDefault = false,
}) {
  const models = state.ollama.models.filter(
    (m) => !cloud(m) && !m.capabilities?.includes("embedding"),
  );
  return (
    <select
      aria-label="Model"
      className="model-select"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="" disabled={!allowDefault}>
        {allowDefault
          ? "Use workspace default"
          : models.length
            ? "Choose a model"
            : "No local models installed"}
      </option>
      {models.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
function App() {
  const [state, setState] = useState(null),
    [view, setView] = useState("home"),
    [taskId, setTaskId] = useState(localStorage.getItem("ember.task")),
    [projectId, setProjectId] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(null),
    [panel, setPanel] = useState(""),
    [search, setSearch] = useState(""),
    [searchQuery, setSearchQuery] = useState(""),
    [pageOffset, setPageOffset] = useState(0),
    [collapsed, setCollapsed] = useState({}),
    [sidebar, setSidebar] = useState(true),
    [offline, setOffline] = useState(false),
    [modelTab, setModelTab] = useState("discover");
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearchQuery(search);
      setPageOffset(0);
    }, 200);
    return () => clearTimeout(timeout);
  }, [search]);
  const projectFilter = view === "project" ? projectId || "" : "";
  useEffect(() => setPageOffset(0), [projectFilter]);
  const toastTimer = useRef();
  const notify = (message, error = false) => {
    setToast({ message, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 8500 : 3500);
  };
  const perform = async (route, data, success) => {
    try {
      const result = await api(route, data);
      if (success) notify(success);
      return result;
    } catch (e) {
      notify(e.message, true);
      throw e;
    }
  };
  const act = (route, data, success) =>
    perform(route, data, success).catch(() => null);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    (async () => {
      while (!disposed) {
        try {
          await subscribe(
            (s) => {
              setState(s);
              setOffline(false);
            },
            controller.signal,
            {
              task: view === "task" ? taskId || "" : "",
              offset: String(pageOffset),
              q: searchQuery,
              project: projectFilter,
            },
          );
        } catch (e) {
          if (disposed) break;
        }
        if (!disposed) {
          setOffline(true);
          await new Promise((r) => setTimeout(r, 1800));
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [taskId, view === "task", pageOffset, searchQuery, projectFilter]);
  useEffect(() => {
    if (state) document.documentElement.dataset.theme = state.settings.theme;
  }, [state?.settings.theme]);
  useEffect(() => {
    const listener = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        newTask();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSidebar(true);
        setTimeout(() => document.getElementById("task-search")?.focus(), 0);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  const task = state?.tasks.find((t) => t.id === taskId);
  const project = state?.projects.find(
    (p) => p.id === (task && view === "task" ? task.projectId : projectId),
  );
  const openTask = (t) => {
    setTaskId(t.id);
    localStorage.setItem("ember.task", t.id);
    setProjectId(t.projectId);
    setView("task");
    setSearch("");
  };
  const newTask = async (p = null, initial = "") => {
    try {
      const t = await perform("tasks", {
        projectId: p,
        mode: p ? "agent" : "chat",
      });
      setState((s) => ({
        ...s,
        tasks: [t, ...s.tasks.filter((x) => x.id !== t.id)],
      }));
      openTask(t);
      if (initial) {
        localStorage.setItem(`ember.draft.${t.id}`, initial);
      }
    } catch {}
  };
  const openModels = (tab = "discover") => {
    setModelTab(tab);
    setView("models");
  };
  if (!state)
    return (
      <div className="loading">
        <Logo size={42} />
        <p>
          {offline
            ? "Waiting for the local workspace…"
            : "Starting your workspace…"}
        </p>
        <span>Ember · powered by Ollama</span>
      </div>
    );
  const localModels = state.ollama.models.filter((m) => !cloud(m));
  const activeDownloads = state.downloads.filter((d) =>
    ["queued", "downloading"].includes(d.status),
  );
  const activeTasks = state.tasks.filter(busy);
  const filteredTasks = state.tasks.filter((t) => !t.archived);
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <aside className="sidebar">
        <div className="brand">
          <button onClick={() => setView("home")}>
            <Logo />
            <span>Ember</span>
            <span className="local-label">LOCAL</span>
          </button>
          <IconButton
            icon="panel"
            label="Hide sidebar"
            onClick={() => setSidebar(false)}
          />
        </div>
        <Button className="new-task" icon="plus" onClick={() => newTask()}>
          <span>New task</span>
          <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} N</kbd>
        </Button>
        <div className="sidebar-search">
          <Icon name="search" size={15} />
          <input
            id="task-search"
            placeholder="Search tasks"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
        </div>
        <nav className="main-nav">
          <button
            className={view === "home" ? "selected" : ""}
            onClick={() => {
              setView("home");
              setProjectId(null);
            }}
          >
            <Icon name="chat" />
            All tasks
            {activeTasks.length > 0 && (
              <span className="count">{activeTasks.length}</span>
            )}
          </button>
          <button
            className={view === "models" ? "selected" : ""}
            onClick={() => openModels()}
          >
            <Icon name="models" />
            Models<span className="count">{localModels.length}</span>
          </button>
          {activeDownloads.length > 0 && (
            <button onClick={() => openModels("downloads")}>
              <Icon name="download" />
              <span>Downloading</span>
              <span className="count">{activeDownloads.length}</span>
            </button>
          )}
        </nav>
        <div className="sidebar-scroll">
          <div className="section-label">
            <span>Projects</span>
            <IconButton
              icon="plus"
              label="Add project"
              onClick={() => setModal({ type: "project" })}
            />
          </div>
          {!state.projects.length && (
            <button
              className="add-project-empty"
              onClick={() => setModal({ type: "project" })}
            >
              <Icon name="folder" size={16} /> Add a project folder
            </button>
          )}
          {state.projects.map((p) => (
            <div className="project-group" key={p.id}>
              <div
                className={`project-row ${view === "project" && projectId === p.id ? "selected" : ""}`}
              >
                <button
                  className="chevron"
                  aria-label={`Toggle ${p.name}`}
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [p.id]: !c[p.id] }))
                  }
                >
                  <Icon name={collapsed[p.id] ? "right" : "down"} size={12} />
                </button>
                <button
                  className="project-name"
                  onClick={() => {
                    setProjectId(p.id);
                    setView("project");
                  }}
                >
                  <Icon name="folder" size={16} />
                  <span>{p.name}</span>
                </button>
                <button
                  className="project-add"
                  aria-label={`New task in ${p.name}`}
                  onClick={() => newTask(p.id)}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
              {!collapsed[p.id] &&
                filteredTasks
                  .filter((t) => t.projectId === p.id)
                  .slice(0, search ? 50 : 8)
                  .map((t) => (
                    <TaskLink
                      key={t.id}
                      task={t}
                      selected={view === "task" && taskId === t.id}
                      onClick={() => openTask(t)}
                    />
                  ))}
              {!collapsed[p.id] &&
                !filteredTasks.some((t) => t.projectId === p.id) && (
                  <div className="no-project-tasks">No tasks yet</div>
                )}
            </div>
          ))}
          <div className="section-label recent-label">
            <span>Recent tasks</span>
          </div>
          {filteredTasks
            .filter((t) => !t.projectId)
            .slice(0, search ? 50 : 20)
            .map((t) => (
              <TaskLink
                key={t.id}
                task={t}
                selected={view === "task" && taskId === t.id}
                onClick={() => openTask(t)}
              />
            ))}
          {!filteredTasks.length && (
            <div className="sidebar-hint">
              {search
                ? "No matching tasks"
                : "A little space for your next idea."}
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <button
            className="runtime-status"
            onClick={() => setModal({ type: "setup" })}
          >
            <span
              className={`status-dot ${state.ollama.connected ? "online" : ""}`}
            />
            <span>
              Ollama {state.ollama.connected ? "connected" : "offline"}
              <small>
                {state.ollama.connected
                  ? `${localModels.length} local models available`
                  : "Set up your local runtime"}
              </small>
            </span>
            <Icon name="right" size={14} />
          </button>
          <div className="footer-actions">
            <button
              onClick={() => setView("settings")}
              className={view === "settings" ? "selected" : ""}
            >
              <Icon name="sliders" size={16} />
              Settings
            </button>
            <span>v1.0.1</span>
            <IconButton
              icon={state.settings.theme === "dark" ? "sun" : "moon"}
              label="Toggle theme"
              onClick={() =>
                act("settings", {
                  theme: state.settings.theme === "dark" ? "light" : "dark",
                })
              }
            />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            {!sidebar && (
              <IconButton
                icon="panel"
                label="Show sidebar"
                onClick={() => setSidebar(true)}
              />
            )}
            <span>
              {view === "models"
                ? "Workspace"
                : view === "settings"
                  ? "Workspace"
                  : project?.name || "Workspace"}
            </span>
            <span className="slash">/</span>
            <strong>
              {view === "models"
                ? "Models"
                : view === "settings"
                  ? "Settings"
                  : view === "project"
                    ? "Overview"
                    : view === "task"
                      ? task?.title || "Task"
                      : "All tasks"}
            </strong>
          </div>
          <div className="top-actions">
            {view === "task" && task && (
              <>
                <span className="top-local">
                  <span className="status-dot online" />
                  {["localhost", "127.0.0.1", "[::1]"].includes(
                    new URL(state.settings.endpoint).hostname,
                  )
                    ? "Local inference"
                    : "Remote inference"}
                </span>
                <IconButton
                  icon="archive"
                  label="Archive task"
                  disabled={busy(task)}
                  onClick={async () => {
                    if (
                      await act("tasks/update", { id: task.id, archived: true })
                    )
                      setView("home");
                  }}
                />
                {project && (
                  <IconButton
                    icon="panel"
                    label="Toggle project panel"
                    onClick={() => setPanel(panel ? "" : "files")}
                  />
                )}
              </>
            )}
            {view !== "task" && (
              <span className="top-local">
                <Icon name="shield" size={14} />
                Your workspace, on your machine
              </span>
            )}
          </div>
        </header>
        {offline && (
          <div className="connection-banner">
            Reconnecting to the workspace. Changes are unavailable until the
            connection returns.
          </div>
        )}
        {view === "models" ? (
          <Models
            state={state}
            tab={modelTab}
            setTab={setModelTab}
            act={act}
            perform={perform}
            notify={notify}
            setModal={setModal}
            newTask={newTask}
          />
        ) : view === "settings" ? (
          <Settings
            state={state}
            perform={perform}
            act={act}
            setModal={setModal}
          />
        ) : view === "task" && task ? (
          <div className="task-layout">
            <TaskView
              key={task.id}
              task={task}
              state={state}
              project={project}
              act={act}
              perform={perform}
              notify={notify}
              setPanel={setPanel}
              openModels={openModels}
              offline={offline}
            />
            {panel && project && (
              <ProjectPanel
                key={`${project.id}:${task.id}`}
                project={project}
                task={task}
                state={state}
                panel={panel}
                setPanel={setPanel}
                act={act}
                notify={notify}
              />
            )}
          </div>
        ) : (
          <Home
            state={state}
            project={view === "project" ? project : null}
            newTask={newTask}
            openTask={openTask}
            openModels={openModels}
            setModal={setModal}
            act={act}
          />
        )}
        {state.taskPage?.total > 100 &&
          !["models", "settings"].includes(view) && (
            <div className="history-pagination">
              <Button
                disabled={pageOffset === 0}
                onClick={() => setPageOffset(Math.max(0, pageOffset - 100))}
              >
                Previous tasks
              </Button>
              <span>
                {pageOffset + 1}–
                {Math.min(pageOffset + 100, state.taskPage.total)} of{" "}
                {state.taskPage.total}
              </span>
              <Button
                disabled={state.taskPage.nextOffset === null}
                onClick={() => setPageOffset(state.taskPage.nextOffset)}
              >
                More tasks
              </Button>
            </div>
          )}
      </main>
      {modal?.type === "project" && (
        <ProjectModal
          project={modal.project}
          state={state}
          onClose={() => setModal(null)}
          perform={perform}
          onCreated={(p) => {
            setProjectId(p.id);
            setView("project");
          }}
        />
      )}
      {modal?.type === "setup" && (
        <Setup
          state={state}
          act={act}
          perform={perform}
          openModels={openModels}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "model" && (
        <ModelDetails
          model={modal.model}
          state={state}
          perform={perform}
          notify={notify}
          onClose={() => setModal(null)}
          openDownloads={() => {
            setModal(null);
            openModels("downloads");
          }}
        />
      )}
      {modal?.type === "pull" && (
        <PullModal
          perform={perform}
          onClose={() => setModal(null)}
          onDownload={() => {
            setModal(null);
            openModels("downloads");
          }}
        />
      )}
      {modal?.type === "delete-model" && (
        <Modal title="Remove local model?" onClose={() => setModal(null)}>
          <div className="modal-body">
            <p>
              This removes <strong>{modal.model.name}</strong> from Ollama and
              may free storage when its layers are no longer shared. Your task
              history stays available.
            </p>
            <div className="dialog-actions">
              <Button onClick={() => setModal(null)}>Keep model</Button>
              <Button
                className="danger"
                icon="trash"
                onClick={async () => {
                  if (
                    await act(
                      "models/delete",
                      { name: modal.model.name },
                      "Model removed",
                    )
                  )
                    setModal(null);
                }}
              >
                Remove model
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <Icon name={toast.error ? "info" : "check"} size={18} />
          <span>{toast.message}</span>
          <IconButton
            icon="close"
            label="Dismiss notification"
            onClick={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
function TaskLink({ task, selected, onClick }) {
  return (
    <button
      className={`task-link ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <span className={`task-status ${task.status}`}>
        {busy(task) ? (
          <span />
        ) : (
          <Icon
            name={
              task.status === "complete"
                ? "check"
                : task.status === "failed"
                  ? "info"
                  : "chat"
            }
            size={13}
          />
        )}
      </span>
      <span>{task.title}</span>
      {task.status === "approval" && <span className="approval-dot" />}
    </button>
  );
}
function Home({
  state,
  project,
  newTask,
  openTask,
  openModels,
  setModal,
  act,
}) {
  const [archived, setArchived] = useState(false);
  const tasks = state.tasks.filter(
    (t) =>
      Boolean(t.archived) === archived &&
      (!project || t.projectId === project.id),
  );
  return (
    <div className="home scroll-area">
      <div className="home-inner">
        <div className="home-hero">
          <div className="hero-logo">
            <Logo size={42} />
          </div>
          <p className="eyebrow">
            {project ? project.name : "YOUR LOCAL WORKSPACE"}
          </p>
          <h1>
            {project
              ? "Let’s move this project forward."
              : "What will you build?"}
          </h1>
          <p className="hero-sub">
            {project
              ? project.path
              : "A place to think, build, and explore. Powered by your models."}
          </p>
          <button
            className="home-composer"
            onClick={() => newTask(project?.id)}
          >
            <span>Ask anything, or start building…</span>
            <div>
              <span>
                <Icon name={project ? "code" : "chat"} size={16} />
                {project ? "Agent" : "Chat"}
                <span className="composer-divider" />
                {project?.model ||
                  state.settings.defaultModel ||
                  "Select a model"}
              </span>
              <span className="send-circle">
                <Icon name="arrow" size={18} />
              </span>
            </div>
          </button>
          <div className="suggestions">
            <button
              onClick={() =>
                newTask(
                  project?.id,
                  project
                    ? "Explore this project and explain its structure."
                    : "Help me plan a new software project.",
                )
              }
            >
              <Icon name="code" size={16} />
              {project ? "Explore codebase" : "Plan a project"}
            </button>
            <button
              onClick={() =>
                newTask(
                  project?.id,
                  project
                    ? "Review this project and identify useful improvements."
                    : "Help me turn an idea into a concrete plan.",
                )
              }
            >
              <Icon name="spark" size={16} />
              {project ? "Review the project" : "Explore an idea"}
            </button>
            <button onClick={() => openModels()}>
              <Icon name="models" size={16} />
              Find a new model
            </button>
          </div>
        </div>
        {!state.settings.onboarded && (
          <div className="welcome-strip">
            <div className="welcome-icon">
              <Icon name="chip" size={22} />
            </div>
            <div>
              <strong>
                {state.ollama.connected
                  ? "Your local engine is ready"
                  : "Connect your local engine"}
              </strong>
              <p>
                {state.ollama.connected
                  ? `${state.ollama.models.filter((m) => !cloud(m)).length} local models detected. Choose your default and make yourself at home.`
                  : "Ember uses Ollama to run open-weight models on your computer."}
              </p>
            </div>
            <Button onClick={() => setModal({ type: "setup" })}>
              Set up workspace
              <Icon name="right" size={14} />
            </Button>
          </div>
        )}
        <div className="task-list-header">
          <h2>
            {project ? "Project tasks" : "Your tasks"}{" "}
            <span>{tasks.length}</span>
          </h2>
          <div>
            {project && (
              <IconButton
                icon="sliders"
                label="Project settings"
                onClick={() => setModal({ type: "project", project })}
              />
            )}
            <button
              className="text-button"
              onClick={() => setArchived(!archived)}
            >
              {archived ? "Show active" : "Archived"}
            </button>
            <Button icon="plus" onClick={() => newTask(project?.id)}>
              New task
            </Button>
          </div>
        </div>
        {tasks.length ? (
          <div className="task-table">
            {tasks.map((t) => (
              <button
                className="task-table-row"
                key={t.id}
                onClick={() => openTask(t)}
              >
                <span className={`row-status ${t.status}`}>
                  <Icon
                    name={
                      t.status === "complete"
                        ? "check"
                        : t.status === "approval"
                          ? "eye"
                          : busy(t)
                            ? "clock"
                            : "chat"
                    }
                    size={18}
                  />
                </span>
                <div>
                  <strong>{t.title}</strong>
                  <p>
                    {state.projects.find((p) => p.id === t.projectId)?.name ||
                      "Personal"}
                    <span>·</span>
                    {t.model || "No model selected"}
                  </p>
                </div>
                <Tag>
                  {t.status === "approval"
                    ? "Needs review"
                    : t.status === "idle"
                      ? "Draft"
                      : t.status}
                </Tag>
                <time>{relativeTime(t.updatedAt)}</time>
                {t.archived && (
                  <span
                    className="text-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      act("tasks/update", { id: t.id, archived: false });
                    }}
                  >
                    Restore
                  </span>
                )}
                <Icon name="right" size={15} />
              </button>
            ))}
          </div>
        ) : (
          <div className="tasks-empty">
            <Icon name="chat" size={20} />
            <p>
              {archived ? "No archived tasks." : "Your next idea starts here."}
            </p>
            <span>
              {archived
                ? "Archived conversations will appear here."
                : "Create a task to keep your conversations and work together."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
function Models({
  state,
  tab,
  setTab,
  act,
  perform,
  notify,
  setModal,
  newTask,
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("popular"),
    [refreshing, setRefreshing] = useState(false),
    [checking, setChecking] = useState(false);
  const installed = state.ollama.models.filter((m) => !cloud(m));
  const updates = Object.values(state.updateChecks).filter(
    (c) => c.status === "available",
  ).length;
  const catalog = state.catalog.models.filter(
    (m) =>
      (!query ||
        `${m.name} ${m.description}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "coding"
          ? /cod|devstral/i.test(m.name)
          : m.capabilities.includes(filter))),
  );
  if (sort === "name") catalog.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "recent")
    catalog.sort(
      (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0),
    );
  return (
    <div className="models-page scroll-area">
      <div className="page-inner">
        <div className="page-heading">
          <div>
            <p className="eyebrow">THE ENGINE BEHIND YOUR IDEAS</p>
            <h1>Model library</h1>
            <p>Find your next model. Make it yours. Run it locally.</p>
          </div>
          <Button
            className="primary"
            icon="plus"
            onClick={() => setModal({ type: "pull" })}
          >
            Pull a model
          </Button>
        </div>
        <div className="model-overview">
          <div className="overview-copy">
            <span className="overview-symbol">
              <Icon name="models" size={28} />
            </span>
            <div>
              <strong>Open models. Endless possibilities.</strong>
              <p>Switch perspectives without leaving your workspace.</p>
            </div>
          </div>
          <div className="overview-stat">
            <strong>{installed.length}</strong>
            <span>Installed models</span>
          </div>
          <div className="overview-stat">
            <strong>{bytes(installed.reduce((s, m) => s + m.size, 0))}</strong>
            <span>
              Sum of model sizes{" "}
              <span title="Layers can be shared across models; this is not actual disk usage.">
                ⓘ
              </span>
            </span>
          </div>
          <div className="overview-stat">
            <strong>{bytes(state.system.totalMemory)}</strong>
            <span>System memory</span>
          </div>
        </div>
        <div className="model-tabs">
          <div role="tablist" aria-label="Model library views">
            {[
              ["discover", "Discover"],
              ["installed", "Installed"],
              ["downloads", "Downloads"],
            ].map(([id, name]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {name}
                {id === "installed" && <span>{installed.length}</span>}
                {id === "downloads" &&
                  state.downloads.some((d) =>
                    ["queued", "downloading"].includes(d.status),
                  ) && (
                    <span className="download-count">
                      {
                        state.downloads.filter((d) =>
                          ["queued", "downloading"].includes(d.status),
                        ).length
                      }
                    </span>
                  )}
              </button>
            ))}
          </div>
          <span className="catalog-source">
            <span className="status-dot online" />
            {tab === "discover" ? "Ollama library" : "Local storage"}
          </span>
        </div>
        {tab === "discover" && (
          <>
            <div className="model-toolbar">
              <div className="search-field">
                <Icon name="search" size={18} />
                <input
                  aria-label="Search model library"
                  placeholder="Search models, families, or capabilities…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <IconButton
                    icon="close"
                    label="Clear search"
                    onClick={() => setQuery("")}
                  />
                )}
              </div>
              <select
                aria-label="Sort models"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="popular">Most popular</option>
                <option value="recent">Recently updated</option>
                <option value="name">Name A–Z</option>
              </select>
              <IconButton
                icon="refresh"
                label="Refresh model catalog"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await act("catalog/refresh", {}, "Model catalog refreshed");
                  setRefreshing(false);
                }}
              />
            </div>
            <div className="filter-row">
              {[
                ["all", "All models"],
                ["coding", "Coding"],
                ["tools", "Tool use"],
                ["thinking", "Reasoning"],
                ["vision", "Vision"],
                ["embedding", "Embedding"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
              <span>{catalog.length} families</span>
            </div>
            {!state.catalog.models.length ? (
              <Empty icon="globe" title="Build your model library">
                Refresh the catalog to browse available models, or pull any
                model by its exact name.
              </Empty>
            ) : !catalog.length ? (
              <Empty icon="search" title="No models found">
                Try a different name or capability.
              </Empty>
            ) : (
              <div className="model-grid">
                {catalog.map((m) => {
                  const locals = installed.filter(
                    (i) => i.name.split(":")[0] === m.name,
                  );
                  const index = state.catalog.models.indexOf(m);
                  return (
                    <button
                      className="model-card"
                      key={m.name}
                      onClick={() => setModal({ type: "model", model: m })}
                    >
                      <div className="model-card-top">
                        <div className={`model-avatar family-${index % 6}`}>
                          {m.name.startsWith("qwen") ? (
                            "Q"
                          ) : m.name.startsWith("llama") ? (
                            "M"
                          ) : m.name.startsWith("gemma") ? (
                            "✦"
                          ) : m.name.startsWith("deepseek") ? (
                            "D"
                          ) : (
                            <Icon name="models" size={23} />
                          )}
                        </div>
                        {locals.length ? (
                          <Tag green>
                            <Icon name="check" size={11} />
                            Installed
                          </Tag>
                        ) : (
                          <Icon name="plus" size={17} />
                        )}
                      </div>
                      <h3>{m.name}</h3>
                      <p className="model-description">{m.description}</p>
                      <div className="model-capabilities">
                        {m.capabilities
                          .filter((c) => c !== "cloud")
                          .slice(0, 3)
                          .map((c) => (
                            <Tag key={c}>
                              {c === "tools"
                                ? "Tool use"
                                : c === "thinking"
                                  ? "Reasoning"
                                  : c}
                            </Tag>
                          ))}
                        {!m.capabilities.filter((c) => c !== "cloud")
                          .length && <Tag>Chat</Tag>}
                      </div>
                      <div className="model-sizes">
                        {m.sizes.slice(0, 6).map((s) => (
                          <span key={s}>{s.toUpperCase()}</span>
                        ))}
                        {m.sizes.length > 6 && (
                          <span>+{m.sizes.length - 6}</span>
                        )}
                      </div>
                      <footer>
                        <span>
                          <Icon name="download" size={13} />
                          {m.pulls || "View variants"}
                        </span>
                        <span>
                          {m.updated || "View details"}
                          <Icon name="right" size={13} />
                        </span>
                      </footer>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="catalog-footnote">
              {state.catalog.fetchedAt
                ? `Catalog cached ${new Date(state.catalog.fetchedAt).toLocaleString()}. Refresh to discover new releases.`
                : "The catalog is fetched from ollama.com."}{" "}
              Cloud variants are excluded from downloads. Model licenses vary.
            </p>
          </>
        )}
        {tab === "installed" && (
          <>
            <div className="model-toolbar">
              <div className="search-field">
                <Icon name="search" size={18} />
                <input
                  aria-label="Search installed models"
                  placeholder="Search installed models…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button
                icon="refresh"
                disabled={checking || !state.ollama.connected}
                onClick={async () => {
                  setChecking(true);
                  await act("models/check", {}, "Update check complete");
                  setChecking(false);
                }}
              >
                {checking ? "Checking…" : "Check for updates"}
              </Button>
            </div>
            {updates > 0 && (
              <div className="notice-banner">
                <Icon name="download" size={17} />
                {updates} model {updates === 1 ? "update is" : "updates are"}{" "}
                available. Update each model when you’re ready.
              </div>
            )}
            {!installed.length ? (
              <Empty icon="models" title="Your models will live here">
                Discover a model and download a variant to get started.
              </Empty>
            ) : (
              <div className="installed-list">
                {installed
                  .filter((m) =>
                    m.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((m) => {
                    const update = state.updateChecks[m.name];
                    const running = state.ollama.running.some(
                      (r) => r.name === m.name || r.model === m.name,
                    );
                    return (
                      <div className="installed-card" key={m.name}>
                        <div className="installed-icon">
                          <Icon name="models" size={23} />
                        </div>
                        <div className="installed-info">
                          <div>
                            <h3>{m.name}</h3>
                            {state.settings.defaultModel === m.name && (
                              <Tag>Default</Tag>
                            )}
                            {running && <Tag green>Loaded</Tag>}
                          </div>
                          <p>
                            {bytes(m.size)}
                            <span>·</span>
                            {m.details?.parameter_size}
                            <span>·</span>
                            {m.details?.quantization_level ||
                              "Quantization unknown"}
                          </p>
                          <span
                            className={`update-status ${update?.status === "available" ? "available" : ""}`}
                          >
                            {update?.status === "current"
                              ? "✓ Up to date"
                              : update?.status === "available"
                                ? "Update available"
                                : update?.status === "unknown"
                                  ? "Update status unknown"
                                  : "Not checked for updates"}
                            {update?.error && (
                              <span title={update.error}> ⓘ</span>
                            )}
                          </span>
                        </div>
                        <div className="installed-actions">
                          <Button
                            onClick={async () => {
                              await act(
                                "settings",
                                { defaultModel: m.name },
                                `${m.name} is now your default`,
                              );
                            }}
                          >
                            Use model
                          </Button>
                          <IconButton
                            icon="info"
                            label={`Details for ${m.name}`}
                            onClick={() =>
                              setModal({
                                type: "model",
                                model: { ...m, installed: true },
                              })
                            }
                          />
                          <IconButton
                            icon="download"
                            label={`Update ${m.name}`}
                            onClick={() =>
                              act(
                                "downloads",
                                { name: m.name },
                                "Model update queued",
                              )
                            }
                          />
                          {running && (
                            <IconButton
                              icon="stop"
                              label={`Unload ${m.name}`}
                              onClick={() =>
                                act(
                                  "models/unload",
                                  { name: m.name },
                                  "Model unloaded",
                                )
                              }
                            />
                          )}
                          <IconButton
                            icon="trash"
                            label={`Remove ${m.name}`}
                            onClick={() =>
                              setModal({ type: "delete-model", model: m })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
            <p className="catalog-footnote">
              “Use model” sets the default for new tasks. Existing tasks keep
              their selected model.
              {state.ollama.models.some(cloud) &&
                ` ${state.ollama.models.filter(cloud).length} cloud entries are hidden.`}
            </p>
          </>
        )}
        {tab === "downloads" && (
          <div className="downloads-view">
            {!state.downloads.length ? (
              <Empty icon="download" title="Ready when you are">
                Downloads appear here with live progress. You can switch tasks
                while they run.
              </Empty>
            ) : (
              state.downloads.map((d) => {
                const percent = d.total
                  ? Math.min(100, Math.floor((d.completed / d.total) * 100))
                  : 0;
                return (
                  <div className="download-card" key={d.id}>
                    <div className="download-icon">
                      <Icon
                        name={
                          d.status === "complete"
                            ? "check"
                            : d.status === "paused"
                              ? "pause"
                              : "download"
                        }
                        size={23}
                      />
                    </div>
                    <div className="download-info">
                      <div>
                        <h3>{d.name}</h3>
                        <Tag green={d.status === "complete"}>{d.status}</Tag>
                      </div>
                      <p>{d.error || d.detail}</p>
                      {d.status !== "complete" && (
                        <div className="progress-track">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                      )}
                      <div className="download-meta">
                        <span>
                          {d.total
                            ? `${bytes(d.completed)} / ${bytes(d.total)}`
                            : "Fetching manifest and layer sizes"}
                        </span>
                        <span>{d.total ? `${percent}%` : ""}</span>
                      </div>
                    </div>
                    <div className="download-actions">
                      {["queued", "downloading"].includes(d.status) && (
                        <Button
                          icon="pause"
                          onClick={() => act("downloads/pause", { id: d.id })}
                        >
                          Pause
                        </Button>
                      )}
                      {["paused", "failed"].includes(d.status) && (
                        <Button
                          icon="play"
                          onClick={() => act("downloads/resume", { id: d.id })}
                        >
                          Resume
                        </Button>
                      )}
                      {d.status === "complete" && (
                        <Button
                          onClick={() =>
                            act(
                              "settings",
                              { defaultModel: d.name },
                              "Default model updated",
                            )
                          }
                        >
                          Use model
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <p className="catalog-footnote">
              Downloads run one at a time. Resuming reuses layers cached by
              Ollama. Updating an active task’s model is blocked until the task
              finishes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
function ModelDetails({
  model,
  state,
  perform,
  notify,
  onClose,
  openDownloads,
}) {
  const [tags, setTags] = useState([]),
    [info, setInfo] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [variant, setVariant] = useState(""),
    [pulling, setPulling] = useState(false),
    [search, setSearch] = useState("");
  const family = model.name.split(":")[0];
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (model.installed) {
          const result = await api(
            `models/info?name=${encodeURIComponent(model.name)}`,
          );
          if (alive) setInfo(result);
        } else {
          const result = await api(
            `catalog/tags?family=${encodeURIComponent(family)}`,
          );
          if (alive) {
            const local = result.filter((t) => !t.cloud);
            setTags(local);
            setVariant(
              local.find((t) => t.name.endsWith(":latest"))?.name ||
                local[0]?.name ||
                "",
            );
          }
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [model.name]);
  const selected = tags.find((t) => t.name === variant);
  const installed = state.ollama.models.some((m) => m.name === variant);
  const fit = selected?.size
    ? selected.size * 1.3 < state.system.freeMemory
      ? "Likely fits in available system memory"
      : selected.size * 1.3 < state.system.totalMemory
        ? "May need memory freed before running"
        : "Likely exceeds this machine’s memory"
    : null;
  return (
    <Modal title={model.name} onClose={onClose} wide>
      <div className="modal-body model-detail">
        <div className="detail-intro">
          <div className="model-avatar">
            <Icon name="models" size={28} />
          </div>
          <div>
            <h3>{family}</h3>
            <p>{model.description || "Installed Ollama model"}</p>
            <a
              href={`https://ollama.com/library/${family}`}
              target="_blank"
              rel="noreferrer"
            >
              View model card & license
              <Icon name="external" size={13} />
            </a>
          </div>
        </div>
        {loading ? (
          <div className="inline-loading">Loading model details…</div>
        ) : error ? (
          <div className="inline-error">{error}</div>
        ) : model.installed ? (
          <>
            <div className="detail-stats">
              <div>
                <span>Size</span>
                <strong>{bytes(model.size)}</strong>
              </div>
              <div>
                <span>Parameters</span>
                <strong>
                  {info?.details?.parameter_size ||
                    model.details?.parameter_size ||
                    "Unknown"}
                </strong>
              </div>
              <div>
                <span>Quantization</span>
                <strong>
                  {info?.details?.quantization_level || "Unknown"}
                </strong>
              </div>
            </div>
            <div className="model-capabilities">
              {(info?.capabilities || []).map((c) => (
                <Tag key={c}>{c}</Tag>
              ))}
            </div>
            <p className="small muted">
              Fingerprint: <code>{model.digest?.slice(0, 20)}</code>
            </p>
            {info?.license && (
              <details className="license">
                <summary>Model license</summary>
                <pre>{info.license}</pre>
              </details>
            )}
            <div className="dialog-actions">
              <Button onClick={onClose}>Close</Button>
              <Button
                className="primary"
                onClick={async () => {
                  try {
                    await perform(
                      "settings",
                      { defaultModel: model.name },
                      "Default model updated",
                    );
                    onClose();
                  } catch {}
                }}
              >
                Use as default
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="variant-heading">
              <h3>Choose a variant</h3>
              <span>{tags.length} local variants</span>
            </div>
            {tags.length === 0 && (
              <p className="notice-banner">
                This family currently has no downloadable local variants.
              </p>
            )}
            {tags.length > 12 && (
              <input
                aria-label="Filter variants"
                placeholder="Filter by size or quantization…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <div className="variant-list">
              {tags
                .filter((t) =>
                  t.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((t) => (
                  <label
                    className={`variant-row ${variant === t.name ? "selected" : ""}`}
                    key={t.name}
                  >
                    <input
                      type="radio"
                      name="variant"
                      value={t.name}
                      checked={variant === t.name}
                      onChange={() => setVariant(t.name)}
                    />
                    <span>
                      <strong>{t.name.split(":")[1]}</strong>
                      <small>
                        {t.context
                          ? `${t.context} context`
                          : "View model card for context"}
                      </small>
                    </span>
                    <span>
                      {state.ollama.models.some((m) => m.name === t.name) && (
                        <Tag green>Installed</Tag>
                      )}
                    </span>
                    <strong>{t.sizeLabel || "Size unknown"}</strong>
                  </label>
                ))}
            </div>
            {fit && (
              <div className="memory-hint">
                <Icon name="chip" size={17} />
                <div>
                  {fit}
                  <small>
                    Estimate includes 30% overhead. Context, GPU memory, and
                    other tasks affect actual requirements.
                  </small>
                </div>
              </div>
            )}
            <div className="dialog-actions">
              <span className="small muted">
                {selected?.sizeLabel
                  ? `${selected.sizeLabel} download`
                  : "Size confirmed during download"}
              </span>
              <Button
                className="primary"
                icon="download"
                disabled={!variant || pulling || !state.ollama.connected}
                onClick={async () => {
                  setPulling(true);
                  try {
                    await perform("downloads", { name: variant });
                    openDownloads();
                  } catch {
                  } finally {
                    setPulling(false);
                  }
                }}
              >
                {pulling
                  ? "Queuing…"
                  : installed
                    ? "Update local copy"
                    : "Download model"}
              </Button>
            </div>
            {!state.ollama.connected && (
              <p className="small warning">
                Connect Ollama before downloading a model.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function PullModal({ perform, onClose, onDownload }) {
  const [name, setName] = useState(""),
    [working, setWorking] = useState(false);
  return (
    <Modal title="Pull a model" onClose={onClose}>
      <form
        className="modal-body form"
        onSubmit={async (e) => {
          e.preventDefault();
          setWorking(true);
          try {
            await perform("downloads", { name });
            onDownload();
          } catch {
          } finally {
            setWorking(false);
          }
        }}
      >
        <p>
          Download an exact model tag from the Ollama registry. Existing layers
          are reused.
        </p>
        <label>
          Model name
          <input
            autoFocus
            required
            placeholder="e.g. qwen3.5:4b"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="small muted">
          Use a local, downloadable variant. Omitting a tag selects{" "}
          <code>:latest</code>.
        </p>
        <div className="dialog-actions">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="primary"
            icon="download"
            disabled={!name.trim() || working}
          >
            {working ? "Queuing…" : "Download"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ProjectModal({ project, state, onClose, perform, onCreated }) {
  const [name, setName] = useState(project?.name || ""),
    [folder, setFolder] = useState(project?.path || ""),
    [instructions, setInstructions] = useState(project?.instructions || ""),
    [model, setModel] = useState(project?.model || ""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal
      title={project ? "Project settings" : "Add a project"}
      onClose={onClose}
    >
      <form
        className="modal-body form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            const p = await perform(
              project ? "projects/update" : "projects",
              project
                ? { id: project.id, name, instructions, model }
                : { name, path: folder, instructions },
            );
            onCreated(p);
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <p>
          {project
            ? "Instructions apply to new turns in this project."
            : "Connect a local folder to give tasks access to your code and files."}
        </p>
        <label>
          Project name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My project"
            maxLength={100}
          />
        </label>
        <label>
          Project folder
          <div className="input-with-button">
            <input
              required
              disabled={Boolean(project)}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="/home/you/projects/my-project"
            />
            {!project && window.emberDesktop && (
              <Button
                type="button"
                icon="folder"
                onClick={async () => {
                  const path = await window.emberDesktop.chooseFolder();
                  if (path) setFolder(path);
                }}
              >
                Browse
              </Button>
            )}
          </div>
        </label>
        <label>
          Project instructions <span className="optional">Optional</span>
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Conventions, preferred tools, and context for the agent…"
            maxLength={20000}
          />
        </label>
        {project && (
          <label>
            Default model
            <ModelSelect
              state={state}
              value={model}
              onChange={setModel}
              allowDefault
            />
          </label>
        )}
        <p className="small muted">
          Agent reads stay inside this folder. Proposed writes and shell
          commands require your review. Commands run with your user’s
          permissions.
        </p>
        {error && <p className="inline-error">{error}</p>}
        <div className="dialog-actions">
          {project ? (
            <Button
              type="button"
              className="danger-ghost"
              onClick={async () => {
                try {
                  await perform(
                    "projects/remove",
                    { id: project.id },
                    "Project removed; files kept",
                  );
                  onClose();
                } catch {}
              }}
            >
              Remove from workspace
            </Button>
          ) : (
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            className="primary"
            disabled={saving || !folder}
          >
            {saving ? "Saving…" : project ? "Save changes" : "Add project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function EnableAgentModal({ task, state, perform, onClose }) {
  const [projectId, setProjectId] = useState(state.projects[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (adding)
    return (
      <ProjectModal
        state={state}
        perform={perform}
        onClose={() => setAdding(false)}
        onCreated={(p) => setProjectId(p.id)}
      />
    );
  return (
    <Modal title="Enable Agent" onClose={onClose}>
      <form
        className="modal-body form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await perform("tasks/enable-agent", { id: task.id, projectId });
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <p>
          Choose a project folder where Agent can work. This conversation and
          your draft will stay here. Earlier requests will not run
          automatically; send your next instruction after enabling Agent.
        </p>
        {state.projects.length > 0 && (
          <label>
            Project
            <select
              aria-label="Agent project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={saving}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          type="button"
          icon="folder"
          disabled={saving}
          onClick={() => setAdding(true)}
        >
          Add a project folder
        </Button>
        <p className="small muted">
          Agent can read files and propose edits and commands, including builds.
          You review writes and commands before they run. Choose a model with
          tool support.
        </p>
        {error && <p className="inline-error">{error}</p>}
        <div className="dialog-actions">
          <Button type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="primary"
            disabled={!projectId || saving}
          >
            {saving ? "Enabling…" : "Enable Agent"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function Setup({ state, act, perform, openModels, onClose }) {
  const [detected, setDetected] = useState(null),
    [working, setWorking] = useState(false);
  useEffect(() => {
    api("ollama/detect")
      .then(setDetected)
      .catch(() => {});
  }, [state.installer.state]);
  return (
    <Modal title="Your local engine" onClose={onClose}>
      <div className="modal-body setup">
        <div className="setup-art">
          <Logo size={52} />
          <span />
          <Icon name="chip" size={45} />
        </div>
        <h2>
          {state.ollama.connected
            ? "Ollama is ready."
            : "Let’s get Ollama connected."}
        </h2>
        <p>
          One local runtime for your models.{" "}
          {["localhost", "127.0.0.1", "[::1]"].includes(
            new URL(state.settings.endpoint).hostname,
          )
            ? "Conversations and project files stay on this machine."
            : "Prompts and project content used by tasks are sent to your configured server."}
        </p>
        <div className="setup-check">
          <span
            className={`status-dot ${detected?.installed ? "online" : ""}`}
          />
          <div>
            <strong>
              {detected
                ? detected.installed
                  ? "Ollama installation detected"
                  : "Ollama is not installed"
                : "Checking installation…"}
            </strong>
            <small>
              {detected?.version?.split("\n").at(-1) ||
                "Looking for the Ollama executable"}
            </small>
          </div>
          {detected?.installed && <Icon name="check" size={18} />}
        </div>
        <div className="setup-check">
          <span
            className={`status-dot ${state.ollama.connected ? "online" : ""}`}
          />
          <div>
            <strong>
              {state.ollama.connected
                ? "Local server connected"
                : "Server is not responding"}
            </strong>
            <small>{state.settings.endpoint}</small>
          </div>
          {state.ollama.connected && <Icon name="check" size={18} />}
        </div>
        {state.ollama.connected && (
          <label className="form-label">
            Default model
            <ModelSelect
              state={state}
              value={state.settings.defaultModel}
              onChange={(model) => act("settings", { defaultModel: model })}
            />
          </label>
        )}
        {!state.ollama.connected && (
          <div className="setup-actions">
            <Button
              disabled={working}
              icon="refresh"
              onClick={async () => {
                setWorking(true);
                await act("ollama/reconnect", {});
                setWorking(false);
              }}
            >
              Reconnect
            </Button>
            {detected?.installed ? (
              <Button
                disabled={working}
                className="primary"
                icon="play"
                onClick={async () => {
                  setWorking(true);
                  await act("ollama/start", {}, "Ollama started");
                  setWorking(false);
                }}
              >
                {working ? "Starting…" : "Start Ollama"}
              </Button>
            ) : detected?.platform === "linux" ? (
              <Button
                disabled={["downloading", "extracting"].includes(
                  state.installer.state,
                )}
                className="primary"
                icon="download"
                onClick={() => act("ollama/install", {})}
              >
                Install Ollama
              </Button>
            ) : (
              <a
                className="button primary"
                href="https://ollama.com/download"
                target="_blank"
                rel="noreferrer"
              >
                Download Ollama
                <Icon name="external" size={15} />
              </a>
            )}
          </div>
        )}
        {state.installer.state !== "idle" && (
          <div className="notice-banner">
            <div>
              <strong>{state.installer.detail}</strong>
              {state.installer.completed > 0 && (
                <p>
                  {bytes(state.installer.completed)} /{" "}
                  {state.installer.total
                    ? bytes(state.installer.total)
                    : "Unknown size"}
                </p>
              )}
            </div>
            {["downloading", "extracting"].includes(state.installer.state) && (
              <Button onClick={() => act("ollama/install/cancel", {})}>
                Cancel
              </Button>
            )}
          </div>
        )}
        {detected && !detected.installed && (
          <p className="small muted">
            Linux installation downloads the official Ollama runtime into
            Ember’s data folder. It needs tar; no administrator access is
            required. GPU drivers are managed by your operating system.
          </p>
        )}
        <div className="dialog-actions">
          <Button
            onClick={() => {
              openModels();
              onClose();
            }}
          >
            Explore models
          </Button>
          <Button
            className="primary"
            onClick={async () => {
              if (await act("settings", { onboarded: true })) onClose();
            }}
          >
            {state.ollama.connected ? "Start building" : "Set up later"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function Settings({ state, perform, act, setModal }) {
  const [endpoint, setEndpoint] = useState(state.settings.endpoint),
    [context, setContext] = useState(state.settings.contextLength),
    [temperature, setTemperature] = useState(state.settings.temperature),
    [concurrency, setConcurrency] = useState(state.settings.concurrency),
    [saving, setSaving] = useState(false);
  return (
    <div className="scroll-area settings-page">
      <div className="settings-inner">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MAKE YOURSELF AT HOME</p>
            <h1>Settings</h1>
            <p>A workspace that runs your way.</p>
          </div>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              await perform(
                "settings",
                {
                  endpoint,
                  contextLength: Number(context),
                  temperature: Number(temperature),
                  concurrency: Number(concurrency),
                },
                "Settings saved",
              );
            } catch {
            } finally {
              setSaving(false);
            }
          }}
        >
          <section className="settings-section">
            <div>
              <Icon name="chip" size={20} />
              <h2>Ollama connection</h2>
            </div>
            <label className="form-label">
              Server address
              <input
                type="url"
                required
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </label>
            <p className="small muted">
              Local by default. A remote address sends prompts and attached
              content to that server.
            </p>
            <div className="settings-runtime">
              <span>
                <span
                  className={`status-dot ${state.ollama.connected ? "online" : ""}`}
                />
                {state.ollama.connected
                  ? `Connected · Ollama ${state.ollama.version}`
                  : "Disconnected"}
              </span>
              <Button type="button" onClick={() => setModal({ type: "setup" })}>
                Manage runtime
              </Button>
            </div>
          </section>
          <section className="settings-section">
            <div>
              <Icon name="sliders" size={20} />
              <h2>Generation</h2>
            </div>
            <label className="form-label">
              Default model
              <ModelSelect
                state={state}
                value={state.settings.defaultModel}
                onChange={(model) => act("settings", { defaultModel: model })}
              />
            </label>
            <div className="form-columns">
              <label className="form-label">
                Context length
                <select
                  aria-label="Context length"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                >
                  {[2048, 4096, 8192, 16384, 32768, 65536, 131072].map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString()} tokens
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-label">
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </label>
            </div>
            <p className="small muted">
              Longer context uses more memory. Old turns are trimmed as complete
              conversations when the budget is reached.
            </p>
          </section>
          <section className="settings-section">
            <div>
              <Icon name="branch" size={20} />
              <h2>Task execution</h2>
            </div>
            <label className="form-label">
              Concurrent tasks
              <select
                aria-label="Concurrent tasks"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {n === 1 ? " · Recommended" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">
              Extra tasks wait in a queue. Running different models
              simultaneously can use substantial memory. Agent turns are limited
              to 12 steps; commands time out after 60 seconds.
            </p>
          </section>
          <div className="settings-save">
            <Button className="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
        <section className="settings-section about-section">
          <div>
            <Logo size={23} />
            <h2>Ember</h2>
            <Tag>Version 1.0.1</Tag>
          </div>
          <p>
            A local AI workspace built around open-weight models and Ollama.
          </p>
          <p className="small muted">
            Data is saved on this machine. Discover and update checks contact
            the Ollama library; downloads contact its registry. No analytics or
            account required.
          </p>
          <a href="https://ollama.com/library" target="_blank" rel="noreferrer">
            Explore the Ollama library <Icon name="external" size={13} />
          </a>
        </section>
      </div>
    </div>
  );
}
function TaskView({
  task,
  state,
  project,
  act,
  perform,
  notify,
  setPanel,
  openModels,
  offline,
}) {
  const [draft, setDraft] = useState(
      () => localStorage.getItem(`ember.draft.${task.id}`) || "",
    ),
    [attachments, setAttachments] = useState([]),
    [sending, setSending] = useState(false),
    [editingTitle, setEditingTitle] = useState(false),
    [title, setTitle] = useState(task.title);
  const [older, setOlder] = useState([]),
    [olderMore, setOlderMore] = useState(true),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [enablingAgent, setEnablingAgent] = useState(false);
  const changeMode = (mode) => {
    if (mode === "agent" && !project) setEnablingAgent(true);
    else act("tasks/update", { id: task.id, mode });
  };
  const visibleMessages = [
    ...older.filter((m) => !task.messages.some((n) => n.id === m.id)),
    ...task.messages,
  ];
  const messagesRef = useRef(),
    inputRef = useRef(),
    fileRef = useRef(),
    follow = useRef(true);
  const active = busy(task);
  const pending = task.approvals.filter((a) => a.status === "pending");
  useEffect(() => {
    localStorage.setItem(`ember.draft.${task.id}`, draft);
  }, [draft, task.id]);
  useEffect(() => {
    if (follow.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [task.messages, task.status, task.approvals]);
  const send = async (e) => {
    e?.preventDefault();
    if (!draft.trim() || active || sending || offline) return;
    setSending(true);
    try {
      await perform("tasks/send", { id: task.id, content: draft, attachments });
      setDraft("");
      setAttachments([]);
      follow.current = true;
    } catch {
    } finally {
      setSending(false);
    }
  };
  const attach = async (files) => {
    try {
      if (attachments.length + files.length > 5)
        throw new Error("Attach up to five text files.");
      const added = [];
      for (const f of files) {
        if (f.size > 100000) throw new Error(`${f.name} exceeds 100 KB.`);
        const content = await f.text();
        if (content.includes("\0"))
          throw new Error("Only text attachments are supported.");
        added.push({ name: f.name, content });
      }
      if (
        [...attachments, ...added].reduce((s, a) => s + a.content.length, 0) >
        100000
      )
        throw new Error("Attachments must total under 100,000 characters.");
      setAttachments((a) => [...a, ...added]);
    } catch (e) {
      notify(e.message, true);
    }
  };
  return (
    <section className="conversation">
      <div className="task-heading">
        <div>
          {editingTitle ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await act("tasks/update", { id: task.id, title });
                setEditingTitle(false);
              }}
            >
              <input
                aria-label="Task title"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
              />
            </form>
          ) : (
            <h2>
              <button
                title="Rename task"
                onClick={() => {
                  setTitle(task.title);
                  setEditingTitle(true);
                }}
              >
                {task.title}
              </button>
            </h2>
          )}
          <p>
            {project ? (
              <>
                <Icon name="folder" size={12} />
                {project.name}
                <span>·</span>
              </>
            ) : null}
            {task.mode === "agent" ? "Agent task" : "Conversation"}
            {task.contextTrimmed > 0 && (
              <span title="Earlier turns remain saved, but are omitted from the model prompt to fit the context budget.">
                · {task.contextTrimmed} earlier turns outside context
              </span>
            )}
          </p>
        </div>
        {project && (
          <Button icon="file" onClick={() => setPanel("files")}>
            Project files
          </Button>
        )}
      </div>
      <div
        className="messages"
        ref={messagesRef}
        onScroll={() => {
          const el = messagesRef.current;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {task.hasOlderMessages && olderMore && (
          <Button
            disabled={loadingOlder}
            onClick={async () => {
              setLoadingOlder(true);
              follow.current = false;
              try {
                const page = await api(
                  `tasks/messages?id=${task.id}&before=${encodeURIComponent(visibleMessages[0].id)}`,
                );
                setOlder((v) => [...page.messages, ...v]);
                setOlderMore(page.hasMore);
              } catch (e) {
                notify(e.message, true);
              } finally {
                setLoadingOlder(false);
              }
            }}
          >
            {loadingOlder ? "Loading…" : "Load earlier messages"}
          </Button>
        )}
        {task.detailLoaded === false ? (
          <p className="inline-loading">Loading conversation…</p>
        ) : !visibleMessages.length ? (
          <div className="conversation-empty">
            <Logo size={40} />
            <h2>
              {project
                ? "Ready to work on " + project.name
                : "Room for your next idea."}
            </h2>
            <p>
              {project
                ? "Ask the agent to explore, build, or improve your project."
                : "Ask a question, work through a problem, or start something new."}
            </p>
            <span>
              {task.model
                ? `Powered locally by ${task.model}`
                : "Choose an installed model below to begin."}
            </span>
          </div>
        ) : (
          visibleMessages.map((m, index) =>
            m.role === "tool" ? (
              <details className="tool-result" key={m.id}>
                <summary>
                  <Icon
                    name={m.tool_name === "run_command" ? "terminal" : "file"}
                    size={14}
                  />
                  {m.tool_name?.replaceAll("_", " ")}
                  <span>
                    {m.content.startsWith("Error:") ? "Error" : "Result"}
                  </span>
                  <Icon name="down" size={13} />
                </summary>
                <pre>{m.content}</pre>
              </details>
            ) : (
              <article key={m.id} className={`message ${m.role}`}>
                <div className="message-author">
                  {m.role === "assistant" ? (
                    <>
                      <Logo size={19} />
                      <strong>Ember</strong>
                      <span>{m.model}</span>
                    </>
                  ) : (
                    <>
                      <span className="user-avatar">Y</span>
                      <strong>You</strong>
                    </>
                  )}
                </div>
                <div className="message-content">
                  {m.role === "user" ? (
                    <div className="user-content">{m.content}</div>
                  ) : m.executionCheck ? (
                    <details className="tool-result">
                      <summary>
                        Draft response — checking tool execution
                      </summary>
                      <Markdown>{m.content}</Markdown>
                    </details>
                  ) : (
                    <Markdown>{m.content}</Markdown>
                  )}
                  {m.executionSummary && (
                    <div className="run-status" role="status">
                      {m.executionSummary.toolCalls === 0
                        ? "Response only: no tools ran, so no files were changed and no commands were executed. If you expected project work, choose another tool-capable model and retry."
                        : `Tool calls: ${m.executionSummary.toolCalls} · File approvals applied: ${m.executionSummary.filesChanged} · Commands succeeded: ${m.executionSummary.commandsSucceeded}`}
                    </div>
                  )}
                  {m.attachments?.length > 0 && (
                    <div className="attachment-list">
                      {m.attachments.map((a, i) => (
                        <span key={i}>
                          <Icon name="file" size={14} />
                          {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.tool_calls?.map((c, i) => (
                    <div className="tool-call-label" key={i}>
                      <Icon name="code" size={14} />
                      {c.function?.name?.replaceAll("_", " ")}
                      <code>
                        {typeof c.function?.arguments === "object"
                          ? c.function.arguments.path ||
                            c.function.arguments.command
                          : ""}
                      </code>
                    </div>
                  ))}
                  {m.role === "assistant" &&
                    !m.content &&
                    !m.tool_calls?.length &&
                    active &&
                    index === visibleMessages.length - 1 && (
                      <div className="thinking">
                        <i />
                        <i />
                        <i />
                        <span>Working locally…</span>
                      </div>
                    )}
                  {m.role === "assistant" && (m.content || m.metrics) && (
                    <div className="message-meta">
                      <IconButton
                        icon="copy"
                        label="Copy response"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(m.content)
                            .then(() => notify("Copied"))
                            .catch(() =>
                              notify("Could not access clipboard", true),
                            )
                        }
                      />
                      {m.metrics?.tokensPerSecond > 0 && (
                        <span>
                          {m.metrics.tokens} tokens ·{" "}
                          {m.metrics.tokensPerSecond.toFixed(1)} tok/s
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ),
          )
        )}
        {pending.map((a) => (
          <Approval
            key={a.id}
            approval={a}
            act={act}
            onInspect={() =>
              setPanel(a.kind === "write" ? "changes" : "terminal")
            }
          />
        ))}
        {task.status === "queued" && (
          <div className="run-status">
            <Icon name="clock" size={16} />
            Queued — waiting for an execution slot
          </div>
        )}
        {task.status === "stopped" && (
          <div className="run-status">
            Generation stopped. You can continue this conversation.
          </div>
        )}
        {task.error && (
          <div className="task-error" role="alert">
            <Icon name="info" size={18} />
            <div>
              <strong>
                {task.status === "interrupted"
                  ? "Turn interrupted"
                  : "This turn could not finish"}
              </strong>
              <p>{task.error}</p>
            </div>
          </div>
        )}
      </div>
      {task.projectId && task.mode === "agent" && (
        <div className="workspace-note">
          <Icon name="branch" size={13} />
          <span>
            {task.workspace?.mode === "worktree"
              ? `Isolated branch: ${task.workspace.branch}`
              : task.workspace?.mode === "shared"
                ? task.workspace.reason
                : "Git projects start in a separate worktree from the latest commit. Uncommitted source changes stay in the original folder."}
          </span>
          {task.workspace?.mode === "worktree" && (
            <button onClick={() => setPanel("changes")}>
              Review project changes
            </button>
          )}
        </div>
      )}
      <div className="composer-wrap">
        {task.archived && (
          <div className="notice-banner">
            This task is archived.
            <Button
              onClick={() =>
                act("tasks/update", { id: task.id, archived: false })
              }
            >
              Restore task
            </Button>
          </div>
        )}
        <form className={`composer ${active ? "working" : ""}`} onSubmit={send}>
          {attachments.length > 0 && (
            <div className="attachment-list composer-attachments">
              {attachments.map((a, i) => (
                <span key={i}>
                  <Icon name="file" size={14} />
                  {a.name}
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      setAttachments((s) => s.filter((_, j) => i !== j))
                    }
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            aria-label="Message"
            placeholder={
              active
                ? "The task is working…"
                : project
                  ? "Describe what you want to build…"
                  : "Ask anything…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
            disabled={task.archived}
            rows={3}
          />
          <div className="composer-bottom">
            <div>
              <input
                type="file"
                multiple
                hidden
                ref={fileRef}
                onChange={(e) => {
                  attach([...e.target.files]);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon="paperclip"
                label="Attach text files"
                type="button"
                disabled={active}
                onClick={() => fileRef.current.click()}
              />
              <select
                aria-label="Task mode"
                value={task.mode}
                disabled={active || task.archived || offline}
                onChange={(e) => changeMode(e.target.value)}
              >
                <option value="chat">Chat</option>
                <option value="agent">Agent</option>
              </select>
              <span className="composer-divider" />
              <ModelSelect
                state={state}
                value={task.model}
                disabled={active}
                onChange={(model) =>
                  act("tasks/update", { id: task.id, model })
                }
              />
            </div>
            {active ? (
              <button
                type="button"
                className="send-button stop-button"
                aria-label="Stop task"
                onClick={() => act("tasks/stop", { id: task.id })}
              >
                <Icon name="stop" size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                aria-label="Send message"
                disabled={
                  !draft.trim() ||
                  !task.model ||
                  !state.ollama.connected ||
                  sending ||
                  task.archived ||
                  offline
                }
              >
                <Icon name="arrow" size={20} />
              </button>
            )}
          </div>
        </form>
        <div className="composer-footnote">
          <span>
            <span
              className={`status-dot ${state.ollama.connected ? "online" : ""}`}
            />
            {task.mode === "agent"
              ? "File changes & commands require review"
              : "Chat only · no file edits or commands"}
          </span>
          {task.mode === "chat" && (
            <button
              type="button"
              disabled={active || task.archived || offline}
              onClick={() => changeMode("agent")}
            >
              Enable Agent
            </button>
          )}
          {!task.model ? (
            <button onClick={() => openModels()}>Get a model</button>
          ) : (
            <span>Enter to send · Shift + Enter for a new line</span>
          )}
        </div>
      </div>
      {enablingAgent && (
        <EnableAgentModal
          task={task}
          state={state}
          perform={perform}
          onClose={() => setEnablingAgent(false)}
        />
      )}
    </section>
  );
}
function Approval({ approval: a, act, onInspect }) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="approval-card">
      <div className="approval-heading">
        <Icon name={a.kind === "write" ? "file" : "terminal"} size={18} />
        <strong>
          {a.kind === "write" ? "Review a file change" : "Review a command"}
        </strong>
        <Tag>Approval needed</Tag>
      </div>
      <code>{a.kind === "write" ? a.path : a.command}</code>
      {a.kind === "write" ? (
        <p>
          {a.before === null ? "Create a new file" : "Replace this file"} ·{" "}
          {a.content.split("\n").length} lines proposed
        </p>
      ) : (
        <p>
          Runs in {a.cwd} with your user’s permissions. This command can access
          files outside the project.
        </p>
      )}
      <div className="approval-actions">
        <Button onClick={onInspect} icon="eye">
          {a.kind === "write" ? "Inspect change" : "View terminal"}
        </Button>
        <div>
          <Button
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              await act("approvals", { id: a.id, approve: false });
              setSubmitting(false);
            }}
          >
            Reject
          </Button>
          <Button
            className="primary"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              await act("approvals", { id: a.id, approve: true });
              setSubmitting(false);
            }}
          >
            {a.kind === "write" ? "Apply change" : "Run command"}
          </Button>
        </div>
      </div>
    </div>
  );
}
function Diff({ before, after }) {
  const old = (before || "").split("\n"),
    next = after.split("\n");
  let prefix = 0;
  while (
    prefix < old.length &&
    prefix < next.length &&
    old[prefix] === next[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  )
    suffix++;
  return (
    <pre className="diff">
      {old.slice(0, prefix).map((l, i) => (
        <span key={`c${i}`} className="context">
          {" "}
          {l}
          {"\n"}
        </span>
      ))}
      {old.slice(prefix, old.length - suffix).map((l, i) => (
        <span key={`r${i}`} className="removed">
          − {l}
          {"\n"}
        </span>
      ))}
      {next.slice(prefix, next.length - suffix).map((l, i) => (
        <span key={`a${i}`} className="added">
          + {l}
          {"\n"}
        </span>
      ))}
      {suffix > 0 &&
        next.slice(-suffix).map((l, i) => (
          <span key={`s${i}`} className="context">
            {" "}
            {l}
            {"\n"}
          </span>
        ))}
    </pre>
  );
}
function FileTree({ project, onFile, taskId = "", directory = "", depth = 0 }) {
  const [files, setFiles] = useState(null),
    [expanded, setExpanded] = useState({}),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api(
      `projects/files?id=${project.id}&task=${taskId}&path=${encodeURIComponent(directory)}`,
    )
      .then((v) => {
        if (alive) setFiles(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [project.id, directory, taskId]);
  if (error) return <p className="inline-error small">{error}</p>;
  if (!files) return <p className="muted small tree-loading">Loading files…</p>;
  return (
    <div className="file-tree">
      {files.map((f) => (
        <React.Fragment key={f.path}>
          <button
            style={{ paddingLeft: 14 + depth * 14 }}
            onClick={() =>
              f.directory
                ? setExpanded((s) => ({ ...s, [f.path]: !s[f.path] }))
                : onFile(f)
            }
          >
            <Icon
              name={
                f.directory ? (expanded[f.path] ? "down" : "right") : "file"
              }
              size={f.directory ? 12 : 14}
            />
            {f.directory && <Icon name="folder" size={14} />}
            <span>{f.name}</span>
          </button>
          {f.directory && expanded[f.path] && depth < 15 && (
            <FileTree
              project={project}
              taskId={taskId}
              onFile={onFile}
              directory={f.path}
              depth={depth + 1}
            />
          )}
        </React.Fragment>
      ))}
      {!files.length && (
        <p className="muted small tree-loading">Empty folder</p>
      )}
    </div>
  );
}
function ProjectPanel({ project, task, state, panel, setPanel, act, notify }) {
  const [file, setFile] = useState(null),
    [content, setContent] = useState(""),
    [command, setCommand] = useState(""),
    [refresh, setRefresh] = useState(0);
  const fileSeq = useRef(0);
  const changes = task.approvals.filter((a) => a.kind === "write");
  const commands = [
    ...task.approvals.filter((a) => a.kind === "command"),
    ...state.terminals.filter(
      (t) => t.projectId === project.id && (!t.taskId || t.taskId === task.id),
    ),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <aside className="project-panel">
      <div className="panel-tabs">
        {["files", "search", "changes", "terminal"].map((v) => (
          <button
            key={v}
            className={panel === v ? "active" : ""}
            onClick={() => setPanel(v)}
          >
            {v}
            {v === "changes" && changes.length > 0 && (
              <span>{changes.length}</span>
            )}
          </button>
        ))}
        <IconButton
          icon="close"
          label="Close project panel"
          onClick={() => setPanel("")}
        />
      </div>
      {panel === "search" && (
        <RepositorySearch project={project} task={task} notify={notify} />
      )}
      {panel === "files" && (
        <>
          <div className="panel-subheader">
            <span>{file ? file.path : project.name}</span>
            <div>
              {file && (
                <IconButton
                  icon="close"
                  label="Close file"
                  onClick={() => {
                    fileSeq.current++;
                    setFile(null);
                  }}
                />
              )}
              <IconButton
                icon="refresh"
                label="Refresh files"
                onClick={() => {
                  fileSeq.current++;
                  setRefresh((n) => n + 1);
                  setFile(null);
                }}
              />
            </div>
          </div>
          <div className="panel-content">
            {file ? (
              <pre className="file-content">{content}</pre>
            ) : (
              <FileTree
                key={`${refresh}:${task.workspace?.path || project.path}`}
                project={project}
                taskId={task.id}
                onFile={async (f) => {
                  const seq = ++fileSeq.current;
                  setFile(f);
                  setContent("Loading…");
                  try {
                    const r = await api(
                      `projects/file?id=${project.id}&task=${task.id}&path=${encodeURIComponent(f.path)}`,
                    );
                    if (seq === fileSeq.current) setContent(r.content);
                  } catch (e) {
                    if (seq === fileSeq.current) setContent(e.message);
                  }
                }}
              />
            )}
          </div>
        </>
      )}
      {panel === "changes" && (
        <div className="panel-content">
          {task.workspace?.mode === "worktree" && (
            <WorktreeReview task={task} act={act} notify={notify} />
          )}

          {!changes.length ? (
            <Empty icon="branch" title="No changes yet">
              Proposed file edits will appear here for review.
            </Empty>
          ) : (
            changes.map((a) => (
              <div className="change-block" key={a.id}>
                <div className="change-header">
                  <Icon name="file" size={14} />
                  <strong>{a.path}</strong>
                  <Tag>{a.status}</Tag>
                </div>
                <Diff before={a.before} after={a.content} />
                {a.error && <p className="inline-error">{a.error}</p>}
                {a.status === "pending" && (
                  <div className="change-actions">
                    <Button
                      onClick={() =>
                        act("approvals", { id: a.id, approve: false })
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      className="primary"
                      onClick={() =>
                        act("approvals", { id: a.id, approve: true })
                      }
                    >
                      Apply change
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {panel === "terminal" && (
        <>
          <div className="terminal-context">
            <Icon name="folder" size={13} />
            {task.workspace?.path || project.path}
          </div>
          <div className="panel-content terminal-content">
            {!commands.length ? (
              <Empty icon="terminal" title="Project terminal">
                Run a command below. Agent commands appear here after review.
              </Empty>
            ) : (
              commands.map((c) => (
                <div className="terminal-block" key={c.id}>
                  <div>
                    <span className="terminal-prompt">$</span>
                    <code>{c.command}</code>
                    <Tag>{c.status}</Tag>
                  </div>
                  {c.output && <pre>{c.output}</pre>}
                  {c.status === "pending" && (
                    <Approval approval={c} act={act} onInspect={() => {}} />
                  )}
                  {c.status === "running" && (
                    <Button
                      icon="stop"
                      onClick={() => act("terminal/stop", { id: c.id })}
                    >
                      Stop
                    </Button>
                  )}
                  {c.code !== undefined && (
                    <span className="terminal-exit">
                      Exit {c.code ?? "signal"}
                      {c.timedOut ? " · Timed out" : ""}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <form
            className="terminal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                command.trim() &&
                (await act("terminal", {
                  projectId: project.id,
                  taskId: task.id,
                  command,
                }))
              )
                setCommand("");
            }}
          >
            <div>
              <span>$</span>
              <input
                aria-label="Terminal command"
                placeholder="Run a shell command…"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <IconButton
                icon="arrow"
                label="Run terminal command"
                type="submit"
                disabled={!command.trim()}
              />
            </div>
            <p>Runs with your user permissions · 60s timeout</p>
          </form>
        </>
      )}
    </aside>
  );
}
function RepositorySearch({ project, task, notify }) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("text"),
    [result, setResult] = useState(null),
    [working, setWorking] = useState(false),
    [excerpt, setExcerpt] = useState(null);
  const request = useRef(0);
  return (
    <div className="panel-content repository-search">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const seq = ++request.current;
          setWorking(true);
          try {
            const r = await api(
              `projects/search?id=${project.id}&task=${task.id}&q=${encodeURIComponent(query)}&kind=${kind}`,
            );
            if (seq === request.current) {
              setResult(r);
              setExcerpt(null);
            }
          } catch (e) {
            notify(e.message, true);
          } finally {
            if (seq === request.current) setWorking(false);
          }
        }}
      >
        <input
          aria-label="Search repository"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find code, files, or symbols…"
        />
        <div>
          <select
            aria-label="Repository search mode"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="text">Code text</option>
            <option value="files">File paths</option>
            <option value="symbols">Declarations</option>
          </select>
          <Button type="submit" disabled={working}>
            {working ? "Searching…" : "Search"}
          </Button>
        </div>
      </form>
      {result && (
        <p className="small muted">
          {result.matches.length} results · {result.engine}
          {result.truncated ? " · Results limited; narrow your search." : ""}
        </p>
      )}
      {result?.matches.map((m, i) => (
        <button
          className="search-result"
          key={i}
          onClick={async () => {
            try {
              const r = await api(
                `projects/excerpt?id=${project.id}&task=${task.id}&path=${encodeURIComponent(m.path)}&line=${m.line || 1}`,
              );
              setExcerpt(r);
            } catch (e) {
              notify(e.message, true);
            }
          }}
        >
          <strong>
            {m.path}
            {m.line ? `:${m.line}` : ""}
          </strong>
          {m.symbol && <Tag>{m.symbol}</Tag>}
          <code>{m.text}</code>
        </button>
      ))}
      {excerpt && (
        <div className="search-excerpt">
          <strong>{excerpt.path}</strong>
          <pre>{excerpt.content}</pre>
        </div>
      )}
      {!result && (
        <Empty icon="search" title="Find the relevant code">
          Search stays inside this task’s folder and returns small, targeted
          excerpts.
        </Empty>
      )}
    </div>
  );
}
function WorktreeReview({ task, act, notify }) {
  const [review, setReview] = useState(null),
    [working, setWorking] = useState(false);
  return (
    <div className="worktree-review">
      <strong>Isolated task branch</strong>
      <code>{task.workspace.branch}</code>
      <p className="small muted">
        Changes here do not affect your original project until you apply them.
        The branch starts from committed HEAD.
      </p>
      <Button
        disabled={busy(task) || working}
        onClick={async () => {
          setWorking(true);
          try {
            setReview(await api(`tasks/worktree/review?id=${task.id}`));
          } catch (e) {
            notify(e.message, true);
          } finally {
            setWorking(false);
          }
        }}
      >
        Review all changes
      </Button>
      {review && (
        <>
          <pre>{review.stat || "No changes"}</pre>
          <details>
            <summary>Inspect complete patch</summary>
            <pre>{review.patch}</pre>
          </details>
          <Button
            className="primary"
            disabled={!review.patch || working || busy(task)}
            onClick={async () => {
              setWorking(true);
              const result = await act("tasks/worktree/apply", {
                id: task.id,
                digest: review.digest,
              });
              if (result) {
                notify(result.message);
                setReview(null);
              }
              setWorking(false);
            }}
          >
            Apply to original project
          </Button>
          <p className="small muted">
            Requires an unchanged, clean original checkout. Changes are applied
            without committing.
          </p>
        </>
      )}
    </div>
  );
}
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="loading">
        <Logo size={42} />
        <h2>The workspace hit a problem.</h2>
        <p>{this.state.error.message}</p>
        <Button onClick={() => location.reload()}>Reload workspace</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
