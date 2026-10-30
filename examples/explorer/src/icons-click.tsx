// The icons of the click action select, copied as SVG paths from react-icons 5.5.0 (https://github.com/react-icons/react-icons, ISC-style
// MIT licence of the package itself) so the example needs no dependency. Each icon keeps the licence of its own set; the notices are in
// THIRD_PARTY_NOTICES at the root. Only the JSX wrapper and the names are ours; they are sized with the font (1em).
//
//   IconInspect  HiEye                    Heroicons 2, MIT
//   IconColour   IoMdColorFill            Ionicons 4, MIT
//   IconReroot   BsFillSkipStartFill      Bootstrap Icons, MIT

import React from 'react';

const svg = (viewBox: string, ...d: [string, boolean?][]) => (
  <svg width="1em" height="1em" viewBox={viewBox} fill="currentColor" aria-hidden="true">
    {d.map(([path, evenodd], i) => (
      <path key={i} d={path} fillRule={evenodd ? 'evenodd' : undefined} clipRule={evenodd ? 'evenodd' : undefined} />
    ))}
  </svg>
);

export const IconInspect = () =>
  svg(
    '0 0 24 24',
    ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
    [
      'M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z',
      true,
    ],
  );
export const IconColour = () =>
  svg('0 0 512 512', [
    'M136.5 77.7l37 67L32 285.7 216.4 464l152.4-148.6 54.4-11.4L166.4 48l-29.9 29.7zm184 208H114.9l102.8-102.3 102.8 102.3zM423.3 304s-56.7 61.5-56.7 92.1c0 30.7 25.4 55.5 56.7 55.5 31.3 0 56.7-24.9 56.7-55.5S423.3 304 423.3 304z',
  ]);
export const IconReroot = () =>
  svg('0 0 16 16', ['M4 4a.5.5 0 0 1 1 0v3.248l6.267-3.636c.54-.313 1.232.066 1.232.696v7.384c0 .63-.692 1.01-1.232.697L5 8.753V12a.5.5 0 0 1-1 0z']);
