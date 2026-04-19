import type { AttachmentRef, BackupSummary, ParseProgress } from '../parser/types';

/** Messages sent from the main thread to the parser Worker. */
export type MainToWorker =
  | { type: 'parse'; buffer: ArrayBuffer }
  | { type: 'slice'; id: number; offset: number; length: number }
  | { type: 'attachment'; id: number; ref: AttachmentRef };

/** Messages sent from the parser Worker back to the main thread. */
export type WorkerToMain =
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'result'; summary: BackupSummary }
  | { type: 'parseError'; message: string }
  | { type: 'slice'; id: number; bytes: Uint8Array }
  | { type: 'sliceError'; id: number; message: string }
  | { type: 'attachment'; id: number; bytes: Uint8Array }
  | { type: 'attachmentError'; id: number; message: string };
