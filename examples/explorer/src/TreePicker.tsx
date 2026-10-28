// The page's tree picker: the trees of src/trees.ts in their groups, and a last group "your own" whose option opens a file input, as the
// playground's (examples/shared/picker.ts, which this renders in React; the file is parsed in a worker by loadFile of src/trees.ts).

import React, { useRef } from 'react';
import { FILE_OPTION, FILE_OPTION_LABEL, FILE_SHOWN } from '../../shared/picker.ts';
import { TREE_FILE_ACCEPT } from '../../shared/data.ts';
import type { Entry } from './trees.ts';

export function TreePicker({
  groups,
  value,
  fileName,
  onTree,
  onFile,
}: {
  groups: Record<string, Record<string, Entry>>;
  /** The id shown; null: a file of one's own; '': none (the list shows nothing, so any entry can be chosen). */
  value: string | null;
  /** The name of the file shown, when `value` is null. */
  fileName?: string;
  onTree: (id: string) => void;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label>
      Tree {/* a controlled select: choosing the file option opens the file input and the list stays on what is shown, so it works every time */}
      <select
        value={value ?? FILE_SHOWN}
        onChange={(e) =>
          e.target.value === FILE_OPTION ? input.current?.click() : e.target.value !== FILE_SHOWN && e.target.value !== '' && onTree(e.target.value)
        }
      >
        {value === '' && <option value="" hidden />}
        {Object.entries(groups).map(([group, entries]) => (
          <optgroup key={group} label={group}>
            {Object.entries(entries).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="your own">
          <option value={FILE_SHOWN} hidden={value !== null}>
            {fileName}
          </option>
          <option value={FILE_OPTION}>{FILE_OPTION_LABEL}</option>
        </optgroup>
      </select>
      <input
        ref={input}
        type="file"
        accept={TREE_FILE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // so the same file can be picked again
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
