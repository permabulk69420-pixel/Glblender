import { Events } from './events.js';
import { applyTransform, sameTransform } from './utils.js';

export class HistoryManager extends Events {
  constructor({ maxBytes = 64 * 1024 * 1024, maxEntries = 100 } = {}) {
    super(); this.undoStack = []; this.redoStack = []; this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.bytes = 0; this.revision = 0;
  }
  commit(command) {
    command.bytes ??= 256;
    this.redoStack = [];
    this.undoStack.push(command); this.bytes += command.bytes;
    while (this.undoStack.length > 1 && (this.bytes > this.maxBytes || this.undoStack.length > this.maxEntries)) {
      this.bytes -= this.undoStack.shift().bytes;
    }
    this.revision++; this.emit('change', command.label);
  }
  execute(command) { command.redo(); this.commit(command); }
  transform(node, before, after, label = 'Transform component') {
    if (sameTransform(before, after)) return false;
    this.commit({ label, undo: () => applyTransform(node, before), redo: () => applyTransform(node, after) });
    return true;
  }
  undo() {
    const c = this.undoStack.pop(); if (!c) return;
    c.undo(); this.bytes -= c.bytes; this.redoStack.push(c); this.revision++; this.emit('change', `Undo ${c.label}`);
  }
  redo() {
    const c = this.redoStack.pop(); if (!c) return;
    c.redo(); this.undoStack.push(c); this.bytes += c.bytes; this.revision++; this.emit('change', `Redo ${c.label}`);
  }
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; this.revision++; this.emit('clear'); this.emit('change', null); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
