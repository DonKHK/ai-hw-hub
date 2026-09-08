import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../context/useAuth'
import {
  createProject,
  listProjectsByMember,
} from '../services/projectService'
import { PROJECT_STATUS_LABELS } from '../types'
import type { Project } from '../types'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '發生未知錯誤，請稍後再試。'
}

export default function DashboardPage() {
  const { user, configured, logout } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const uid = user?.uid

  useEffect(() => {
    let cancelled = false
    if (!configured || uid === undefined) {
      return
    }
    listProjectsByMember(uid)
      .then((items) => {
        if (!cancelled) {
          setProjects(items)
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
  }, [configured, uid])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)
    const trimmedName = name.trim()
    if (trimmedName === '') {
      setCreateError('請輸入專案名稱。')
      return
    }
    if (uid === undefined) {
      setCreateError('登入狀態已失效，請重新登入。')
      return
    }
    setCreating(true)
    try {
      const project = await createProject({
        name: trimmedName,
        description: description.trim(),
        ownerId: uid,
        memberIds: [uid],
        status: 'active',
      })
      setProjects((previous) => [project, ...previous])
      setName('')
      setDescription('')
    } catch (error: unknown) {
      setCreateError(errorText(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <AppHeader />
      <main className="page">
        <div className="page-header">
          <div>
            <h1>我的專案</h1>
            <p className="muted">
              登入用戶：{user?.displayName?.trim() !== '' && user?.displayName
                ? user.displayName
                : user?.email ?? '—'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void logout()}
          >
            登出
          </button>
        </div>

        {!configured ? (
          <section className="card notice">
            <h2>尚未設定 Firebase</h2>
            <p>
              你需要喺 <code>.env</code> 填寫 Firebase config（參考{' '}
              <code>.env.example</code> 同 README.md），先可以用到登入同資料儲存。
            </p>
          </section>
        ) : (
          <>
            <section className="card">
              <h2>開新專案</h2>
              <form className="form-grid" onSubmit={handleCreate}>
                <input
                  className="input"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="專案名稱（必填）"
                  required
                />
                <input
                  className="input"
                  type="text"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="專案簡介（可選）"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? '建立中…' : '建立專案'}
                </button>
              </form>
              {createError !== null && (
                <p className="error-text">{createError}</p>
              )}
            </section>

            <section className="project-section">
              <h2>全部專案（{projects.length}）</h2>
              {loading && <p className="muted">載入中…</p>}
              {!loading && loadError !== null && (
                <p className="error-text">{loadError}</p>
              )}
              {!loading && loadError === null && projects.length === 0 && (
                <p className="muted">未有專案，建立你嘅第一個專案啦！</p>
              )}
              <div className="project-grid">
                {projects.map((project) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="card project-card"
                  >
                    <div className="project-card-header">
                      <h3>{project.name}</h3>
                      <span className="chip">{PROJECT_STATUS_LABELS[project.status]}</span>
                    </div>
                    <p className="project-card-desc">
                      {project.description !== ''
                        ? project.description
                        : '（冇簡介）'}
                    </p>
                    <p className="muted project-card-meta">
                      成員 {project.memberIds.length} 人 · 更新於{' '}
                      {new Date(project.updatedAt).toLocaleString('zh-Hant')}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  )
}
