import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type { DocumentSnapshot, Firestore } from 'firebase/firestore'
import { db } from '../firebase/config'
import type { NewProject, Project } from '../types'

function requireDb(): Firestore {
  if (db === null) {
    throw new Error(
      'Firebase 尚未設定。請參考 README.md 填寫 .env 後再重新啟動。',
    )
  }
  return db
}

function snapshotToProject(snapshot: DocumentSnapshot): Project {
  const data = snapshot.data()
  if (data === undefined) {
    throw new Error('讀取專案資料失敗。')
  }
  return {
    id: snapshot.id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    ownerId: String(data.ownerId ?? ''),
    memberIds: Array.isArray(data.memberIds)
      ? (data.memberIds as string[])
      : [],
    status:
      data.status === 'completed' || data.status === 'archived'
        ? data.status
        : 'active',
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  }
}

/** 列出「用戶係成員」嘅全部專案（client 端按更新時間排序，避免需要複合 index） */
export async function listProjectsByMember(uid: string): Promise<Project[]> {
  const firestore = requireDb()
  const snapshot = await getDocs(
    query(
      collection(firestore, 'projects'),
      where('memberIds', 'array-contains', uid),
    ),
  )
  return snapshot.docs
    .map(snapshotToProject)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getProject(projectId: string): Promise<Project | null> {
  const firestore = requireDb()
  const snapshot = await getDoc(doc(firestore, 'projects', projectId))
  if (!snapshot.exists()) {
    return null
  }
  return snapshotToProject(snapshot)
}

export async function createProject(input: NewProject): Promise<Project> {
  const firestore = requireDb()
  const now = Date.now()
  const documentRef = await addDoc(collection(firestore, 'projects'), {
    ...input,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id: documentRef.id,
    ...input,
    createdAt: now,
    updatedAt: now,
  }
}
