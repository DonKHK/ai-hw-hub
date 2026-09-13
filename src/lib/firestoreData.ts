/**
 * Firestore 寫入前嘅資料清理。
 *
 * Firestore **唔接受 `undefined`** —— `set()` / `addDoc()` / `updateDoc()`
 * / `writeBatch.set()` 全部都會 throw：
 *   `Unsupported field value: undefined (found in field xxx)`
 *
 * 注意：`null` 同 `''` 空字串都係**合法**嘅 —— 只有 `undefined` 唔得。
 * 所以寫入前要踢走 undefined（欄位變「唔存在」，讀取時一樣當佢冇值）。
 */
export function withoutUndefined<T extends object>(
  value: T,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      cleaned[key] = item
    }
  }
  return cleaned
}
