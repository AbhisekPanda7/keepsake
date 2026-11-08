import { COUPLE } from '@/lib/album/categories';

/** A single figure for Individual, two side by side for Couple. Drawn in the current colour. */
export default function CategoryIcon({ category, size = 20 }) {
  return (
    <svg className="category-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {category === COUPLE ? (
          <>
            <circle cx="8.6" cy="8.4" r="3.1" />
            <path d="M2.6 20c0-3.4 2.7-6.1 6-6.1s6 2.7 6 6.1" />
            <circle cx="16" cy="7.6" r="2.7" />
            <path d="M15 13.3c.33-.06.67-.09 1-.09 3 0 5.4 2.5 5.4 5.6v1.2" />
          </>
        ) : (
          <>
            <circle cx="12" cy="8.2" r="3.4" />
            <path d="M5.4 20c0-3.7 3-6.7 6.6-6.7s6.6 3 6.6 6.7" />
          </>
        )}
      </g>
    </svg>
  );
}
