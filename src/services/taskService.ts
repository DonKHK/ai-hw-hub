import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import type { DocumentSnapshot, Firestore } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { NewTask, Task, TaskStatus } from '../types'

function requireDb(): Firestore {
  if (db === null) {
    throw new Error(
      'Firebase 尚未設定。請參考 README.md 填寫 .env 後再重新啟動。',
    )
  }
  return db
}

function snapshotToTask(snapshot: DocumentSnapshot): Task {
  const data = snapshot.data()
  if (data === undefined) {
    throw new Error('讀取任務資料失敗。')
  }
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ''),
    title: String(data.title ?? ''),
    description: String(data.description ?? ''),
    status:
      data.status === 'todo' ||
      data.status === 'in_progress' ||
      data.status === 'done'
        ? data.status
        : 'todo',
    createdBy: String(data.createdBy ?? ''),
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  }
}

/** 列出指定專案嘅全部任務（按建立時間由舊到新） */
export async function listTasksByProject(projectId: string): Promise<Task[]> {
  const firestore = requireDb()
  const snapshot = await getDocs(
    query(
      collection(firestore, 'tasks'),
      where('projectId', '==', projectId),
    ),
  )
  return snapshot.docs
    .map(snapshotToTask)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function addTask(input: NewTask): Promise<Task> {
  const firestore = requireDb()
  const now = Date.now()
  const documentRef = await addDoc(collection(firestore, 'tasks'), {
    ...input,
    createdAt: now,
  })
  return {
    id: documentRef.id,
    ...input,
    createdAt: now,
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const firestore = requireDb()
  await updateDoc(doc(firestore, 'tasks', taskId), { status })
}

export async function deleteTask(taskId: string): Promise<void> {
  const firestore = requireDb()
  await deleteDoc(doc(firestore, 'tasks', taskId))
}
