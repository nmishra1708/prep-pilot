let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null) {
  currentUserId = userId;
}

export function getCurrentUserId() {
  return currentUserId;
}

export function scopedDatabaseName(name: string) {
  return currentUserId ? `${name}-${currentUserId}` : name;
}
