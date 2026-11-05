// Saving a data file whole: written beside it, then moved over it, so a reader never sees half of one. Saves of one
// file go one at a time: two writing the same .tmp at once can leave the file half-written for a moment, or fail.
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const queue = new Map<string, Promise<unknown>>();
export function replaceFile(file: string, text: string, mode?: number): Promise<void> {
  const run = (queue.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, text, mode == null ? undefined : { mode });
    await rename(`${file}.tmp`, file);
  });
  const tail = run.catch(() => {});
  queue.set(file, tail);
  void tail.then(() => { if (queue.get(file) === tail) queue.delete(file); });
  return run;
}
