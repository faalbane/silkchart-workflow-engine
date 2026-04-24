import { promises as fs } from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import type { Workflow } from './types';

/**
 * Persists workflows as one JSON file per workflow. Writes are atomic on POSIX
 * filesystems: we write a temp file, fsync it, then rename over the target. A
 * crash at any point leaves either the previous committed state or the new
 * one, never a torn file. That property is what makes resume correct.
 *
 * The engine serialises mutations per workflow, so the store itself does not
 * need additional locking.
 */
@Injectable()
export class WorkflowStore {
  private readonly logger = new Logger(WorkflowStore.name);
  private readonly dir: string;
  /** Monotonic counter used to make tmp filenames unique within the process. */
  private tmpCounter = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  getDir(): string {
    return this.dir;
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async save(workflow: Workflow): Promise<void> {
    workflow.updatedAt = new Date().toISOString();
    const target = this.filePath(workflow.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.${++this.tmpCounter}.tmp`;
    const body = JSON.stringify(workflow, null, 2);

    const fh = await fs.open(tmp, 'w');
    try {
      await fh.writeFile(body, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, target);
  }

  async load(id: string): Promise<Workflow | null> {
    try {
      const raw = await fs.readFile(this.filePath(id), 'utf8');
      return JSON.parse(raw) as Workflow;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(): Promise<Workflow[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = entries.filter((name) => name.endsWith('.json'));
    const results: Workflow[] = [];
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(this.dir, file), 'utf8');
        results.push(JSON.parse(raw) as Workflow);
      } catch (err) {
        this.logger.warn(`Skipping unreadable workflow file ${file}: ${(err as Error).message}`);
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
