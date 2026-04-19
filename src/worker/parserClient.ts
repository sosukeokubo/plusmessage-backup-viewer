import type { BackupSummary, ParseProgress } from '../parser/types';
import type { MainToWorker, WorkerToMain } from './protocol';

export interface ParseOptions {
  onProgress?: (p: ParseProgress) => void;
}

interface PendingSlice {
  resolve: (bytes: Uint8Array) => void;
  reject: (err: Error) => void;
}

/**
 * Thin Promise-based wrapper around the parser Worker. One client owns one
 * Worker and therefore one backup buffer; call {@link terminate} before
 * loading a new file.
 */
export class ParserClient {
  private readonly worker: Worker;
  private sliceSeq = 0;
  private readonly pendingSlices = new Map<number, PendingSlice>();
  private parsePromise: {
    resolve: (s: BackupSummary) => void;
    reject: (err: Error) => void;
    onProgress?: (p: ParseProgress) => void;
  } | null = null;

  constructor() {
    this.worker = new Worker(new URL('./parser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'plusmessage-parser',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => {
      const err = new Error(`worker error: ${e.message}`);
      this.parsePromise?.reject(err);
      this.parsePromise = null;
      for (const pending of this.pendingSlices.values()) pending.reject(err);
      this.pendingSlices.clear();
    };
  }

  parse(buffer: ArrayBuffer, opts: ParseOptions = {}): Promise<BackupSummary> {
    if (this.parsePromise) {
      return Promise.reject(new Error('parse already in progress'));
    }
    return new Promise<BackupSummary>((resolve, reject) => {
      const entry: {
        resolve: (s: BackupSummary) => void;
        reject: (err: Error) => void;
        onProgress?: (p: ParseProgress) => void;
      } = { resolve, reject };
      if (opts.onProgress) entry.onProgress = opts.onProgress;
      this.parsePromise = entry;
      const msg: MainToWorker = { type: 'parse', buffer };
      this.worker.postMessage(msg, [buffer]);
    });
  }

  getSlice(offset: number, length: number): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const id = ++this.sliceSeq;
      this.pendingSlices.set(id, { resolve, reject });
      const msg: MainToWorker = { type: 'slice', id, offset, length };
      this.worker.postMessage(msg);
    });
  }

  terminate(): void {
    this.worker.terminate();
    const err = new Error('worker terminated');
    this.parsePromise?.reject(err);
    this.parsePromise = null;
    for (const pending of this.pendingSlices.values()) pending.reject(err);
    this.pendingSlices.clear();
  }

  private handleMessage(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'progress':
        this.parsePromise?.onProgress?.(msg.progress);
        break;
      case 'result':
        this.parsePromise?.resolve(msg.summary);
        this.parsePromise = null;
        break;
      case 'parseError':
        this.parsePromise?.reject(new Error(msg.message));
        this.parsePromise = null;
        break;
      case 'slice': {
        const pending = this.pendingSlices.get(msg.id);
        if (pending) {
          this.pendingSlices.delete(msg.id);
          pending.resolve(msg.bytes);
        }
        break;
      }
      case 'sliceError': {
        const pending = this.pendingSlices.get(msg.id);
        if (pending) {
          this.pendingSlices.delete(msg.id);
          pending.reject(new Error(msg.message));
        }
        break;
      }
    }
  }
}
