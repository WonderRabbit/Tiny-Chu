import { lstat, symlink } from "node:fs/promises";

async function inferTargetKind(target) {
  try {
    return (await lstat(target)).isDirectory() ? "dir" : "file";
  } catch {
    return "file";
  }
}

export async function createPortableSymlink(target, linkPath, targetKind) {
  const kind = targetKind ?? await inferTargetKind(target);
  const type = process.platform === "win32" && kind === "dir" ? "junction" : kind;
  await symlink(target, linkPath, type);
}
