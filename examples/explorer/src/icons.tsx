// The toolbar icons of Reactree (reactreejs 1.0.3, https://github.com/vaaloo/reactreejs, src/icons.tsx and the inline SVGs of
// src/Reactree.tsx), copied so this example looks like it. Only the JSX wrapper and the names are ours.
//
// MIT License. Copyright (c) 2026 Valentin Gorgodian (the copyright line of the reactreejs LICENSE).
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
// (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished
// to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
// EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import React from 'react';

const s = { stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconRect = () => (
  <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <path d="M1,2h1M2,2v5.5M2,4h4.3M2,7.5h8M4.8,7.9v3.3M4.8,11.3h4.4" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconCirc = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 7l3.9-3.9M7 7l4.5 1.5M7 7l1.5 4.5M7 7l-4.5 1.5M7 7l-3.9-3.9" {...s} strokeWidth="1.1" />
    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
  </svg>
);
export const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8.5 8.5L12 12" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconExport = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1v8M4 6l3 3 3-3" {...s} strokeWidth="1.6" />
    <path d="M2 11h10" {...s} strokeWidth="1.6" />
  </svg>
);
export const IconUp = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 6.5l3-3 3 3" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconDown = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5l3 3 3-3" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconClose = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M2 2l6 6M8 2l-6 6" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconPalette = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path
      d="M7 1.5a5.5 5.5 0 1 0 3.54 9.67c.6-.53.46-1.17-.14-1.17H9a1.5 1.5 0 0 1 0-3h.5A5.5 5.5 0 0 0 7 1.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <circle cx="4" cy="7" r="1" fill="currentColor" />
    <circle cx="4.5" cy="4.5" r="1" fill="currentColor" />
    <circle cx="7" cy="3.5" r="1" fill="currentColor" />
    <circle cx="9.5" cy="4.5" r="1" fill="currentColor" />
  </svg>
);
export const IconEraser = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 11l4-4M3.5 5.5l4 4M3.5 5.5L7 2l4 4-3.5 3.5" {...s} strokeWidth="1.4" />
    <path d="M2 11h9" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconExpandAll = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 6.5h9M6.5 2l4.5 4.5L6.5 11" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconCopy = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <rect x="3.5" y="3.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M2 7.5V2a1 1 0 0 1 1-1h5.5" {...s} strokeWidth="1.3" />
  </svg>
);
export const IconDrag = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    {[2, 5].flatMap((x) => [2, 5, 8].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
  </svg>
);
export const IconFilePng = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="4" cy="4.5" r="1" fill="currentColor" />
    <path d="M1.5 9.5l2.5-3L6 8l2-2.5 2.5 3.5" {...s} strokeWidth="1.2" />
  </svg>
);
export const IconFileNewick = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 3h1.5M2 6h3M2 9h2" {...s} strokeWidth="1.3" />
    <path d="M6 3.5l1.5 2.5L9 3.5" {...s} strokeWidth="1.2" />
    <path d="M6 9V6h3v3" {...s} strokeWidth="1.2" />
  </svg>
);
// ours, in the style of the ones above: NEXUS files start with #NEXUS
export const IconFileNexus = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4.8 3.5l-.6 5M7.8 3.5l-.6 5M3.5 5h5.5M3 7h5.5" {...s} strokeWidth="1.1" />
  </svg>
);
