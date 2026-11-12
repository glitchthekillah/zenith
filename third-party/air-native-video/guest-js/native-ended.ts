export function isNativeEnded(snapshot) {
  if (!snapshot) return false
  return snapshot.ended ?? Boolean(!snapshot.live && snapshot.durationSeconds > 0 && snapshot.currentTimeSeconds >= snapshot.durationSeconds)
}
