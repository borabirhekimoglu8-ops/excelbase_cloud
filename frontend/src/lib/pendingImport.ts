/** Files handed from the assistant (or home) to the import screen. */
let pending: File[] = [];

export function setPendingImportFiles(files: File[]): void {
  pending = files.slice();
}

export function takePendingImportFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}
