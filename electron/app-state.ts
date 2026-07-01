let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(v: boolean): void {
  isQuitting = v;
}
