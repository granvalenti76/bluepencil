/** Line icons in the style of SF Symbols (sidebar.left, sidebar.right, eye), drawn by hand. */
const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  "aria-hidden": true,
} as const;

export const SidebarLeftIcon = () => (
  <svg {...base}>
    <rect x="1.7" y="2.7" width="14.6" height="12.6" rx="2.4" />
    <path d="M6.6 2.9v12.2" />
  </svg>
);

export const SidebarRightIcon = () => (
  <svg {...base}>
    <rect x="1.7" y="2.7" width="14.6" height="12.6" rx="2.4" />
    <path d="M11.4 2.9v12.2" />
  </svg>
);

export const ChevronDownIcon = () => (
  <svg {...base} width={10} height={10} viewBox="0 0 10 10">
    <path d="M2 3.6 5 6.6l3-3" />
  </svg>
);

export const EyeIcon = () => (
  <svg {...base}>
    <path d="M1.6 9s2.7-5 7.4-5 7.4 5 7.4 5-2.7 5-7.4 5-7.4-5-7.4-5Z" />
    <circle cx="9" cy="9" r="2.3" />
  </svg>
);

/** Focus: a crosshair. */
export const ScopeIcon = () => (
  <svg {...base}>
    <circle cx="9" cy="9" r="6.3" />
    <circle cx="9" cy="9" r="2.2" />
  </svg>
);

/** Hemingway: a stylised fountain pen (forward only, no eraser). */
export const PenIcon = () => (
  <svg {...base}>
    <path d="M12.2 2.6 15.4 5.8 6.6 14.6 2.6 15.4 3.4 11.4Z" />
    <path d="M10.6 4.2 13.8 7.4" />
  </svg>
);

/** Note type filter. */
export const FilterIcon = () => (
  <svg {...base}>
    <path d="M2.5 4.5h13M5 9h8M7.5 13.5h3" />
  </svg>
);

export const FolderIcon = () => (
  <svg {...base}>
    <path d="M2.5 5.2V13a1.3 1.3 0 0 0 1.3 1.3h10.4a1.3 1.3 0 0 0 1.3-1.3V6.9a1.3 1.3 0 0 0-1.3-1.3H9L7.4 3.7H3.8a1.3 1.3 0 0 0-1.3 1.5Z" />
  </svg>
);

/** Settings: gear. */
export const GearIcon = () => (
  <svg {...base}>
    <circle cx="9" cy="9" r="2.3" />
    <path d="M9 1.9v2M9 14.1v2M1.9 9h2M14.1 9h2M4 4l1.4 1.4M12.6 12.6 14 14M4 14l1.4-1.4M12.6 5.4 14 4" />
    <circle cx="9" cy="9" r="4.6" />
  </svg>
);

/** Text format: "Aa". */
/** More actions: three dots. */
export const MoreIcon = () => (
  <svg {...base}>
    <circle cx="4" cy="9" r="0.9" fill="currentColor" />
    <circle cx="9" cy="9" r="0.9" fill="currentColor" />
    <circle cx="14" cy="9" r="0.9" fill="currentColor" />
  </svg>
);

/** Delete: a bin. */
export const TrashIcon = () => (
  <svg {...base}>
    <path d="M3 4.8h12M7.2 4.6V3.2h3.6v1.4M4.6 4.8l.7 9.4a1.2 1.2 0 0 0 1.2 1.1h5a1.2 1.2 0 0 0 1.2-1.1l.7-9.4M7.6 7.6v5M10.4 7.6v5" />
  </svg>
);

/** Review: a spark (the model at work). */
export const SparkIcon = () => (
  <svg {...base}>
    <path d="M9 2.2c.5 3.2 1.6 4.3 4.8 4.8-3.2.5-4.3 1.6-4.8 4.8-.5-3.2-1.6-4.3-4.8-4.8 3.2-.5 4.3-1.6 4.8-4.8Z" />
    <path d="M14 11.6c.2 1.2.6 1.6 1.8 1.8-1.2.2-1.6.6-1.8 1.8-.2-1.2-.6-1.6-1.8-1.8 1.2-.2 1.6-.6 1.8-1.8Z" />
  </svg>
);

/** A closed review pass. */
export const CheckIcon = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12" strokeWidth={1.8}>
    <path d="m2.4 6.3 2.4 2.4 4.8-5" />
  </svg>
);

/** Formatting bar: link, code, lists, quote, source. */
export const LinkIcon = () => (
  <svg {...base}>
    <path d="M7.6 10.4a3 3 0 0 0 4.3 0l2.4-2.4a3 3 0 0 0-4.3-4.3l-.9.9" />
    <path d="M10.4 7.6a3 3 0 0 0-4.3 0L3.7 10a3 3 0 0 0 4.3 4.3l.9-.9" />
  </svg>
);

export const CodeIcon = () => (
  <svg {...base}>
    <path d="m6 5-4 4 4 4M12 5l4 4-4 4" />
  </svg>
);

export const ListIcon = () => (
  <svg {...base}>
    <path d="M7 5h8.5M7 9h8.5M7 13h8.5" />
    <path d="M3 5h1M3 9h1M3 13h1" strokeWidth={2} strokeLinecap="round" />
  </svg>
);

export const NumberedIcon = () => (
  <svg {...base}>
    <path d="M7.5 5h8M7.5 9h8M7.5 13h8" />
    <path
      d="M2.6 3.6 3.8 3v4M2.6 11.2c.3-.6 1.9-.8 1.9.3 0 .9-1.9 1.4-1.9 2.6h2"
      strokeWidth={1.1}
    />
  </svg>
);

export const QuoteIcon = () => (
  <svg {...base}>
    <path d="M3.4 4v10M7 6h8M7 9h8M7 12h5.5" />
  </svg>
);

export const SourceIcon = () => (
  <svg {...base}>
    <path d="M3 3.5h4.2A1.8 1.8 0 0 1 9 5.3V15a1.4 1.4 0 0 0-1.4-1.4H3ZM15 3.5h-4.2A1.8 1.8 0 0 0 9 5.3V15a1.4 1.4 0 0 1 1.4-1.4H15Z" />
  </svg>
);
