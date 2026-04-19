/// <reference lib="webworker" />
import { inflate } from 'pako';
import { parseBackup, summarizeBackup } from '../parser';
import type { AttachmentRef } from '../parser/types';
import type { MainToWorker, WorkerToMain } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The Worker owns the 65MB file buffer after receiving it via a transferable
 * ArrayBuffer. The main thread keeps only the lightweight summary; when it
 * needs raw bytes (attachments, hex slices) it asks for a `slice`.
 */
let owned: Uint8Array | null = null;

function post(msg: WorkerToMain, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    ctx.postMessage(msg, transfer);
  } else {
    ctx.postMessage(msg);
  }
}

function handleParse(buffer: ArrayBuffer) {
  owned = new Uint8Array(buffer);
  try {
    const backup = parseBackup(owned, (progress) => {
      post({ type: 'progress', progress });
    });
    const summary = summarizeBackup(backup);
    post({ type: 'result', summary });
  } catch (err) {
    post({
      type: 'parseError',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function sliceOwned(offset: number, length: number): Uint8Array | { error: string } {
  if (!owned) return { error: 'no buffer loaded' };
  if (offset < 0 || length < 0 || offset + length > owned.length) {
    return { error: `slice out of range: [${offset}, ${offset + length}) of ${owned.length}` };
  }
  const copy = new Uint8Array(length);
  copy.set(owned.subarray(offset, offset + length));
  return copy;
}

function handleSlice(id: number, offset: number, length: number) {
  const res = sliceOwned(offset, length);
  if (res instanceof Uint8Array) {
    post({ type: 'slice', id, bytes: res }, [res.buffer]);
  } else {
    post({ type: 'sliceError', id, message: res.error });
  }
}

function handleAttachment(id: number, ref: AttachmentRef) {
  const sliced = sliceOwned(ref.sourceOffset, ref.length);
  if (!(sliced instanceof Uint8Array)) {
    post({ type: 'attachmentError', id, message: sliced.error });
    return;
  }
  if (ref.encoding === 'raw') {
    post({ type: 'attachment', id, bytes: sliced }, [sliced.buffer]);
    return;
  }
  // 'zlib-png' — inflate the slice and ship the decoded PNG bytes.
  try {
    const decoded = inflate(sliced);
    post({ type: 'attachment', id, bytes: decoded }, [decoded.buffer]);
  } catch (err) {
    post({
      type: 'attachmentError',
      id,
      message: `inflate failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const data = e.data;
  switch (data.type) {
    case 'parse':
      handleParse(data.buffer);
      break;
    case 'slice':
      handleSlice(data.id, data.offset, data.length);
      break;
    case 'attachment':
      handleAttachment(data.id, data.ref);
      break;
  }
};
