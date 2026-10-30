// Icons copied from Feather (https://github.com/feathericons/feather 4.29.2, MIT, Copyright (c) 2013-2023 Cole Bemis; the notice is in
// THIRD_PARTY_NOTICES at the root), as react-icons' `fi` set has them. Only the JSX wrapper and the names are ours. Two are changed:
//
//   IconCollapse  Feather minimize-2, its lower-left arrow mirrored to the right, below the upper-right one (both arrows on the right)
//   IconExpand    Feather maximize-2, its lower-left arrow mirrored the same way, so it points down-right, not down-left
//
//   IconSubtree   FiArrowDownRight   IconUpLevel  FiArrowUpLeft   IconReset  FiCornerUpLeft   IconFit  FiMaximize

import React from 'react';

const icon = (children: React.ReactNode) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconSubtree = () =>
  icon(
    <>
      <line x1="7" y1="7" x2="17" y2="17" />
      <polyline points="17 7 17 17 7 17" />
    </>,
  );
export const IconUpLevel = () =>
  icon(
    <>
      <line x1="17" y1="17" x2="7" y2="7" />
      <polyline points="7 17 7 7 17 7" />
    </>,
  );
export const IconReset = () =>
  icon(
    <>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>,
  );
export const IconCollapse = () =>
  icon(
    <>
      <polyline points="20 14 14 14 14 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="21" y1="21" x2="14" y2="14" />
    </>,
  );
export const IconExpand = () =>
  icon(
    <>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="15 21 21 21 21 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="21" y1="21" x2="14" y2="14" />
    </>,
  );
export const IconFit = () => icon(<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />);
