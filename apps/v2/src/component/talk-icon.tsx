import type { ReactNode } from "react";

const paths = {
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  plus: <path d="M12 4v16M4 12h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  send: <path d="M12 20V4m-7 7 7-7 7 7" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8" cy="9" r="2" />
      <path d="m3 17 6-5 5 4 3-3 4 4" />
    </>
  ),
  phone: <path d="m7 3 3 5-3 3c1 3 3 5 6 6l3-3 5 3-1 4C10 23 1 14 3 4Z" />,
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-4-6 4Z" />,
  heart: <path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 8 15 8 15S25 10 20 5Z" />,
  thumb: (
    <>
      <path d="M8 10 12 3c3 0 2 5 2 6h5c3 0 1 7-1 11H8ZM3 10h5v10H3Z" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  speaker: (
    <>
      <path d="M11 4 5 9H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
} satisfies Record<string, ReactNode>;

export const TalkIcon = ({ name }: { name: keyof typeof paths }) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths[name]}
  </svg>
);
