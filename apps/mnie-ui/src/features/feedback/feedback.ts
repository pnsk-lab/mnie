import { ref } from 'vue'

export const notifications = ref<Array<{ id: number; message: string; kind: 'error' | 'success' }>>(
  [],
)
let nextId = 0
export const dismissNotification = (id: number) => {
  notifications.value = notifications.value.filter((item) => item.id !== id)
}
export const notify = (message: string, kind: 'error' | 'success' = 'error') => {
  if (notifications.value.some((item) => item.message === message)) return
  const id = ++nextId
  notifications.value = [...notifications.value, { id, message, kind }]
  if (kind === 'success') setTimeout(() => dismissNotification(id), 6000)
}
export const notifyError = (cause: unknown) =>
  notify(cause instanceof Error ? cause.message : String(cause))
