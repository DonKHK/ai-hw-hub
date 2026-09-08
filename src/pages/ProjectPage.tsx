import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../context/useAuth'
import { getProject } from '../services/projectService'
import {
  addTask,
  deleteTask,
  listTasksByProject,
  updateTaskStatus,
} from '../services/taskService'
import {
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_OPTIONS,
} from '../types'
import type { Project, Task, TaskStatus } from '../types'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤，請稍後再試。'
}

export default function ProjectPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getProject(projectId), listTasksByProject(projectId)])
      .then(([projectResult, taskResult]) => {
        if (!cancelled) {
          setProject(projectResult)
          setTasks(taskResult)
          setLoadError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(errorText(error))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function handleAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError(null)
    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setActionError('請輸入任務名稱。')
      return
    }
    if (user === null) {
      setActionError('登入狀態已失效，請重新登入。')
      return
    }
    setAdding(true)
    try {
      const task = await addTask({
        projectId,
        title: trimmedTitle,
        description: description.trim(),
        status: 'todo',
        createdBy: user.uid,
      })
      setTasks((previous) => [...previous, task])
      setTitle('')
      setDescription('')
    } catch (error: unknown) {
      setActionError(errorText(error))
    } finally {
      setAdding(false)
    }
  }

  async function handleStatusChange(taskId: string, nextStatus: TaskStatus) {
    setActionError(null)
    try {
      await updateTaskStatus(taskId, nextStatus)
      setTasks((previous) =>
        previous.map((task) =>
          task.id === taskId ? { ...task, status: nextStatus } : task,
        ),
      )
    } catch (error: unknown) {
      setActionError(errorText(error))
    }
  }

  async function handleDeleteTask(taskId: string) {
    setActionError(null)
    try {
      await deleteTask(taskId)
      setTasks((previous) => previous.filter((task) => task.id !== taskId))
    } catch (error: unknown) {
      setActionError(errorText(error))
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        {loading ? (
          <p className="muted">載入中…</p>
        ) : loadError !== null ? (
          <>
            <p className="error-text">{loadError}</p>
            <Link to="/" className="btn btn-ghost">
              ← 返回專案列表
            </Link>
          </>
        ) : project === null ? (
          <>
            <p className="error-text">搵唔到呢個專案，可能已被刪除。</p>
            <Link to="/" className="btn btn-ghost">
              ← 返回專案列表
            </Link>
          </>
        ) : (
          <>
            <div className="page-header">
              <div>
                <Link to="/" className="back-link">
                  ← 返回專案列表
                </Link>
                <div className="page-header-title-row">
                  <h1>{project.name}</h1>
                  <span className="chip chip-project">
                    {PROJECT_STATUS_LABELS[project.status]}
                  </span>
                </div>
                <p className="muted">
                  {project.description !== ''
                    ? project.description
                    : '（冇簡介）'}
                  {' · '}成員 {project.memberIds.length} 人
                </p>
              </div>
            </div>

            {actionError !== null && (
              <p className="error-text">{actionError}</p>
            )}

            <section className="card">
              <h2>新增任務</h2>
              <form className="form-grid task-form" onSubmit={handleAddTask}>
                <input
                  className="input"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="任務名稱（必填）"
                  required
                />
                <input
                  className="input"
                  type="text"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="任務詳情（可選）"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={adding}
                >
                  {adding ? '新增中…' : '新增任務'}
                </button>
              </form>
            </section>

            <section className="project-section">
              <h2>任務清單（{tasks.length}）</h2>
              {tasks.length === 0 && (
                <p className="muted">未有任務，新增第一個任務啦！</p>
              )}
              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.id} className="card task-item">
                    <div className="task-main">
                      <h3>{task.title}</h3>
                      {task.description !== '' && <p>{task.description}</p>}
                      <p className="muted task-meta">
                        建立於{' '}
                        {new Date(task.createdAt).toLocaleString('zh-Hant')}
                      </p>
                    </div>
                    <div className="task-actions">
                      <span className={`chip chip-${task.status}`}>
                        {TASK_STATUS_LABELS[task.status]}
                      </span>
                      <label className="field field-inline">
                        <span>狀態</span>
                        <select
                          className="input"
                          value={task.status}
                          onChange={(event) =>
                            void handleStatusChange(
                              task.id,
                              event.target.value as TaskStatus,
                            )
                          }
                        >
                          {TASK_STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {TASK_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleDeleteTask(task.id)}
                      >
                        刪除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  )
}

