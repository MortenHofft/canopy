// The parse worker (#4): one request (a ParseRequest), answered with progress messages and then the packed tree or the error
// (transfer.ts). Started by worker.ts; a page does not import this module.

import { runParse, type ParseRequest } from './transfer.ts';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};
scope.onmessage = (e) => void runParse(e.data, (m, transfer = []) => scope.postMessage(m, transfer));
