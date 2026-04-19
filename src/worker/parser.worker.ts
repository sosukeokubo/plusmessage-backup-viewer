/// <reference lib="webworker" />
import { parseBackup, summarizeBackup } from '../parser';
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

function handleSlice(id: number, offset: number, length: number) {
  if (!owned) {
    post({ type: 'sliceError', id, message: 'no buffer loaded' });
    return;
  }
  if (offset < 0 || length < 0 || offset + length > owned.length) {
    post({
      type: 'sliceError',
      id,
      message: `slice out of range: [${offset}, ${offset + length}) of ${owned.length}`,
    });
    return;
  }
  // Copy into an owned ArrayBuffer so it can be transferred without
  // detaching the main buffer.
  const copy = new Uint8Array(length);
  copy.set(owned.subarray(offset, offset + length));
  post({ type: 'slice', id, bytes: copy }, [copy.buffer]);
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
  }
};
