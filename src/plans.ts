import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Plan files live in .pi/plans/, reviewable and committable. */
export function plansDir(cwd: string): string {
  return join(cwd, ".pi", "plans");
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "plan";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Create the plan file, uniquified when the slug collides on the same day. */
export function createPlanFile(cwd: string, title: string, content: string): string {
  const dir = plansDir(cwd);
  mkdirSync(dir, { recursive: true });
  const base = `${localDateStr()}-${slugify(title)}`;
  let file = join(dir, `${base}.md`);
  let counter = 2;
  while (existsSync(file)) {
    file = join(dir, `${base}-${counter}.md`);
    counter++;
  }
  writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`);
  return file;
}
