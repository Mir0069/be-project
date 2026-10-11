const STORAGE_KEY = "gfs_dismissed_notifications";

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

const write = (ids: string[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    return;
  }
};

export const getDismissedIds = (): Set<string> => new Set(read());

export const isDismissed = (id: string): boolean => read().includes(id);

export const dismissNotification = (id: string): void => {
  const ids = read();
  if (ids.includes(id)) return;
  write([...ids, id]);
};

export const restoreNotification = (id: string): void => {
  write(read().filter((dismissedId) => dismissedId !== id));
};

export const clearDismissed = (): void => write([]);
