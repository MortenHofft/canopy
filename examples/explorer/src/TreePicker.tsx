// The page's tree picker: the trees of src/trees.ts in their groups, and a last group "your own" whose option opens a file input, as the
// playground's (examples/shared/picker.ts, which this renders in React; the file is read by loadTreeFile of examples/shared/data.ts).

import React, { useRef } from 'react';
import { FILE_OPTION, FILE_OPTION_LABEL } from '../../shared/picker.ts';
import { TREE_FILE_ACCEPT } from '../../shared/data.ts';
import type { Entry } from './trees.ts';

export function TreePicker({
  groups,
  value,
  onTree,
  onFile,
}: {
  groups: Record<string, Record<string, Entry>>;
  /** The id shown; null: a file of one's own. */
  value: string | null;
  onTree: (id: string) => void;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label>
      Tree{' '}
      <select value={value ?? FILE_OPTION} onChange={(e) => (e.target.value === FILE_OPTION ? input.current?.click() : onTree(e.target.value))}>
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
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
