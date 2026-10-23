// The tree picker of the pages without a framework (the playground, the table view, the unrooted page): a <select> of trees in
// <optgroup>s, with a last group "your own" whose one option opens a file input, and that file input. The explorer (React) renders the
// same in src/TreePicker.tsx with FILE_OPTION and TREE_FILE_ACCEPT. Reading the file is loadTreeFile in data.ts.

import { TREE_FILE_ACCEPT } from './data.ts';

/** The value of the "A file from your computer…" option: it opens the file input, and the list goes back to what is shown. */
export const FILE_OPTION = '__file';
export const FILE_OPTION_LABEL = 'A file from your computer…';
/** The value of the option that names the file shown (in "your own", after a file is loaded), so the file option can be chosen again. */
export const FILE_SHOWN = '__file-shown';

export interface PickerItem {
  label: string;
  /** Listed but not selectable (the unrooted page: a tree above its node limit). */
  disabled?: boolean;
}

export interface PickerHandlers {
  /** A tree of the list was picked. */
  onTree(id: string): void;
  /** A file was picked; the list then names it. */
  onFile(file: File): void;
}

export interface Picker {
  /** Show the tree `id` in the list, or (null) the file `fileName`: e.g. back to the tree still shown after a load failed. */
  show(id: string | null, fileName?: string): void;
}

/** Fill `select` with `groups` and the file option, show `value` (null: a file, not named yet) and wire it and `input` to `handlers`. */
export function treePicker(
  select: HTMLSelectElement,
  input: HTMLInputElement,
  groups: Record<string, Record<string, PickerItem>>,
  value: string | null,
  handlers: PickerHandlers,
): Picker {
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
  const fileShown = new Option('', FILE_SHOWN);
  fileShown.hidden = true;
  own.append(fileShown, new Option(FILE_OPTION_LABEL, FILE_OPTION));
  select.append(own);
  let shown = FILE_SHOWN;
  const show = (id: string | null, fileName = '') => {
    fileShown.hidden = id !== null;
    if (id === null) fileShown.text = fileName;
    shown = id ?? FILE_SHOWN;
    select.value = shown;
  };
  show(value);
  input.accept = TREE_FILE_ACCEPT;
  select.addEventListener('change', () => {
    if (select.value === FILE_SHOWN) return;
    if (select.value !== FILE_OPTION) {
      shown = select.value;
      return handlers.onTree(select.value);
    }
    select.value = shown; // the list keeps naming what is shown until a file is picked
    input.click();
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = ''; // so the same file can be picked again
    if (!f) return;
    show(null, f.name);
    handlers.onFile(f);
  });
  return { show };
}
