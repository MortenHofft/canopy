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

export const IconWidth = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 7h12M9 4l3 3-3 3M5 4L2 7l3 3" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconHeight = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1v12M4 9l3 3 3-3M4 5L7 2l3 3" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconFont = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <text x="0" y="11" fontSize="11" fontFamily="system-ui" fontWeight="700">
      A
    </text>
    <text x="9" y="13" fontSize="7" fontFamily="system-ui">
      a
    </text>
  </svg>
);
export const IconBranchWidth = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 4h12" {...s} strokeWidth="1" />
    <path d="M1 7.5h12" {...s} strokeWidth="2" />
    <path d="M1 11.5h12" {...s} strokeWidth="3" />
  </svg>
);
export const IconRect = () => (
  <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
    <path d="M1 2h1M2 2v9M2 4h4M2 7h8M2 11h5" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconCirc = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 7l3.9-3.9M7 7l4.5 1.5M7 7l1.5 4.5M7 7l-4.5 1.5M7 7l-3.9-3.9" {...s} strokeWidth="1.1" />
    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
  </svg>
);
export const IconPhylo = () => (
  <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
    <path d="M1 2h9M1 6h13M1 10h6" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconClado = () => (
  <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
    <path d="M1 2h10M1 6h10M1 10h10" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconTruncate = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M1 3.5h12M1 7h7M1 10.5h12" {...s} strokeWidth="1.4" />
    <circle cx="9.5" cy="7" r="0.8" fill="currentColor" />
    <circle cx="11.5" cy="7" r="0.8" fill="currentColor" />
    <circle cx="13.5" cy="7" r="0.8" fill="currentColor" />
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
export const IconChevronDown = ({ size = 9 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 9 9" fill="none">
    <path d="M2 3.5l2.5 2.5L7 3.5" {...s} strokeWidth="1.4" />
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
export const IconUndo = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 6.5A4.5 4.5 0 1 1 6.5 11" {...s} strokeWidth="1.5" />
    <path d="M2 3.5V7h3.5" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconFit = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
    <path d="M7.5 1.5a6 6 0 1 0 5.5 3.6" {...s} strokeWidth="1.5" />
    <path d="M13 1l-.5 4-4-.5" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconReroot = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 1v2M7 11v2M1 7h2M11 7h2" {...s} strokeWidth="1.5" />
    <path d="M3.2 3.2l1.4 1.4M9.4 9.4l1.4 1.4M9.4 4.6L8 6M5.4 8l-1.4 1.4" {...s} strokeWidth="1.2" />
  </svg>
);
export const IconMidpoint = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <line x1="7" y1="1" x2="7" y2="13" {...s} strokeWidth="1.5" strokeDasharray="2 1.5" />
    <path d="M7 7 L2 4 M7 7 L12 4 M7 7 L2 10 M7 7 L12 10" {...s} strokeWidth="1.3" />
    <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.85" />
  </svg>
);
export const IconFlip = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3 4V10M3 4L1 6M3 4L5 6" {...s} strokeWidth="1.4" />
    <path d="M11 10V4M11 10L9 8M11 10L13 8" {...s} strokeWidth="1.4" />
    <path d="M7 2v10" {...s} strokeWidth="1.2" strokeDasharray="2 2" />
  </svg>
);
export const IconSwap = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 4h10M11 4L9 2M11 4L9 6" {...s} strokeWidth="1.4" />
    <path d="M13 10H3M3 10l2-2M3 10l2 2" {...s} strokeWidth="1.4" />
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
export const IconLadderize = ({ asc }: { asc: boolean }) => (
  <svg width="14" height="13" viewBox="0 0 14 13" fill="none">
    <path d={asc ? 'M1 11h2M1 7.5h5M1 4h8M1 1h12' : 'M1 1h2M1 4.5h5M1 8h8M1 11h12'} {...s} strokeWidth="1.4" />
  </svg>
);
export const IconExpandAll = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M2 6.5h9M6.5 2l4.5 4.5L6.5 11" {...s} strokeWidth="1.4" />
  </svg>
);
export const IconAlnTrack = () => (
  <svg width="14" height="11" viewBox="0 0 16 12" fill="none">
    {[0.9, 0.5, 0.85, 0.6, 0.6, 0.9, 0.4, 0.9, 0.4, 0.85, 0.7, 0.5].map((o, i) => (
      <rect key={i} x={(i % 4) * 4} y={Math.floor(i / 4) * 4.5} width="3" height="3" rx="0.6" fill="currentColor" opacity={o} />
    ))}
  </svg>
);
export const IconAlignLabels = () => (
  <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
    <path d="M1 2h3M1 5.5h6M1 9h4" {...s} strokeWidth="1.35" />
    <path d="M4.5 2h5.5M7.5 5.5h2.5M6 9h4" {...s} strokeWidth="1" strokeDasharray="1.4 1.2" opacity="0.5" />
    <path d="M11 2h3M11 5.5h3M11 9h3" {...s} strokeWidth="1.5" />
  </svg>
);
export const IconBootstrap = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    <text x="7" y="10" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">
      %
    </text>
  </svg>
);
export const IconLabelsOff = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.8 1.8" />
  </svg>
);
export const IconBranchLen = () => (
  <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
    <path d="M1 5.5h13M1 2v7M14 2v7" {...s} strokeWidth="1.4" />
    <path d="M5 4l-1.5 1.5L5 7M10 4l1.5 1.5L10 7" {...s} strokeWidth="1.2" />
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
export const IconFileSvg = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M3.5 6h5M6 3.5v5" {...s} strokeWidth="1.3" />
  </svg>
);
export const IconFilePng = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="4" cy="4.5" r="1" fill="currentColor" />
    <path d="M1.5 9.5l2.5-3L6 8l2-2.5 2.5 3.5" {...s} strokeWidth="1.2" />
  </svg>
);
export const IconFilePdf = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4 5h1.5a1 1 0 0 1 0 2H4V5Z" {...s} strokeWidth="1.1" />
    <path d="M4 7v2M7.5 5v4" {...s} strokeWidth="1.2" />
    <path d="M7.5 9c1 0 1.5-.5 1.5-2s-.5-2-1.5-2" {...s} strokeWidth="1.2" />
  </svg>
);
export const IconFileNewick = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 3h1.5M2 6h3M2 9h2" {...s} strokeWidth="1.3" />
    <path d="M6 3.5l1.5 2.5L9 3.5" {...s} strokeWidth="1.2" />
    <path d="M6 9V6h3v3" {...s} strokeWidth="1.2" />
  </svg>
);
