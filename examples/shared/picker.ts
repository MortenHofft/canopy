// The tree picker of the pages without a framework (the playground, the table view, the unrooted page): a <select> of trees in
// <optgroup>s, with a last group "your own" whose one option opens a file input, and that file input. The explorer (React) renders the
// same in src/TreePicker.tsx with FILE_OPTION and TREE_FILE_ACCEPT. Reading the file is loadTreeFile in data.ts.

import { TREE_FILE_ACCEPT } from './data.ts';

/** The value of the "A file from your computer…" option. */
export const FILE_OPTION = '__file';
export const FILE_OPTION_LABEL = 'A file from your computer…';

export interface PickerItem {
  label: string;
  /** Listed but not selectable (the unrooted page: a tree above its node limit). */
  disabled?: boolean;
}

export interface PickerHandlers {
  /** A tree of the list was picked. */
  onTree(id: string): void;
  /** A file was picked; the select then shows the file option. */
  onFile(file: File): void;
}

/** Fill `select` with `groups` and the file option, show `value` (null: the file option) and wire it and `input` to `handlers`. */
export function treePicker(
  select: HTMLSelectElement,
  input: HTMLInputElement,
  groups: Record<string, Record<string, PickerItem>>,
  value: string | null,
  handlers: PickerHandlers,
): void {
  for (const [group, entries] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const [id, e] of Object.entries(entries)) {
      const o = new Option(e.label, id);
      o.disabled = e.disabled === true;
      og.append(o);
    }
    select.append(og);
  }
  const own = document.createElement('optgroup');
  own.label = 'your own';
  own.append(new Option(FILE_OPTION_LABEL, FILE_OPTION));
  select.append(own);
  select.value = value ?? FILE_OPTION;
  input.accept = TREE_FILE_ACCEPT;
  select.addEventListener('change', () => {
    if (select.value === FILE_OPTION) return input.click();
    handlers.onTree(select.value);
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    select.value = FILE_OPTION;
    handlers.onFile(f);
  });
}
