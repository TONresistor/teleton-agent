import {
  closeSync,
  existsSync,
  fchownSync,
  fchmodSync,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, basename } from "node:path";

/** Replace a private file without exposing a partially written document. Follows existing symlinks. */
export function writePrivateFileAtomic(path: string, content: string): void {
  const target = existsSync(path) ? realpathSync(path) : path;
  const prior = existsSync(target) ? statSync(target) : undefined;
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    if (prior && (prior.uid !== process.getuid?.() || prior.gid !== process.getgid?.())) {
      fchownSync(fd, prior.uid, prior.gid);
    }
    if (prior) fchmodSync(fd, prior.mode & 0o777);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, target);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
