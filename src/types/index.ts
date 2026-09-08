export type ProjectStatus = 'active' | 'completed' | 'archived'

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface AppUser {
  uid: string
  email: string | null
  displayName: string | null
}

export interface Project {
  id: string
  name: string
  description: string
  ownerId: string
  memberIds: string[]
  status: ProjectStatus
  /** Unix 毫秒 */
  createdAt: number
  /** Unix 毫秒 */
  updatedAt: number
}

export type NewProject = Pick<
  Project,
  'name' | 'description' | 'ownerId' | 'memberIds' | 'status'
>

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  createdBy: string
  /** Unix 毫秒 */
  createdAt: number
}

export type NewTask = Pick<
  Task,
  'projectId' | 'title' | 'description' | 'status' | 'createdBy'
>

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '進行中',
  completed: '已完成',
  archived: '已封存',
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待辦',
  in_progress: '進行中',
  done: '已完成',
}

export const TASK_STATUS_OPTIONS: TaskStatus[] = ['todo', 'in_progress', 'done']
