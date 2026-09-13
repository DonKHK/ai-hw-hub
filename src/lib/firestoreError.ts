/**
 * Firestore 錯誤 → 人話（指向根因同解決方法）。
 *
 * 點解要集中處理：`permission-denied` 只會顯示
 * 「Missing or insufficient permissions.」—— 完全睇唔出係規則問題，
 * 令人查錯方向（我哋就係咁卡咗幾轉）。
 */
export function describeStoreError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
  const message = error instanceof Error ? error.message : String(error)

  // 🛡️ 我哋自己包裝嘅錯誤（例如「重設前備份失敗」）本身已經係「人話」，
  //    唔好再判斷／翻譯 —— 否則結尾嵌住嘅原始 Firestore 訊息
  //    （"Missing or insufficient permissions"）會令佢被當成 permission-denied，
  //    連最有價值嘅「NOTHING was deleted」都被蓋掉。
  if (code === 'backup-failed') {
    return message
  }

  const looksLikePermission =
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    message.includes('Missing or insufficient permissions')

  if (looksLikePermission) {
    return [
      'Firestore rules are not published / not in effect (PERMISSION_DENIED). ',
      'Fix: Firebase Console → your project → Firestore → ',
      'Rules tab → paste the whole firestore.rules → Publish.',
    ].join('')
  }

  if (code === 'unavailable' || message.includes('Failed to get document')) {
    return 'Cannot reach Firestore (possibly a network issue). Check your connection and try again.'
  }

  if (code === 'not-found') {
    return 'The Firestore database does not exist — create the (default) database in the Console.'
  }

  if (message.includes('Unsupported field value: undefined')) {
    return 'Invalid data format on write (an undefined field was included) — please report this error.'
  }

  return message === '' ? 'Unknown error.' : message
}
