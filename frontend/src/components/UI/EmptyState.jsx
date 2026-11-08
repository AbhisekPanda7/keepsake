'use client';

import { forwardRef } from 'react';

/** A small gilt scroll ending in a curl, either side of the motto. */
function Flourish({ mirrored = false }) {
  return (
    <svg
      className="guide-flourish"
      viewBox="0 0 72 20"
      width="72"
      height="20"
      aria-hidden="true"
      focusable="false"
      style={mirrored ? { transform: 'scaleX(-1)' } : undefined}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
        <path d="M2 10c10 0 16-5 26-5s14 6 22 6c5 0 8-3 8-5.5S55.5 2 53 3.3s-2.3 5 0.6 5.6" />
        <circle cx="62" cy="10" r="4.6" />
        <circle cx="62" cy="10" r="1.6" fill="currentColor" stroke="none" />
        <path d="M66.6 10H71" />
      </g>
    </svg>
  );
}

/** The one line of guidance shown above an open book. */
const EmptyState = forwardRef(function EmptyState({ visible, isEmpty, showHint, singlePage, uploading, onFiles }, ref) {
  let content = null;
  if (isEmpty) {
    // A motto between two gilt flourishes. "Add photographs" in the toolbar below is the way in.
    content = (
      <span className="guide-motto">
        <Flourish />
        <span>
          A keepsake of life&rsquo;s most cherished <em>moments</em>
        </span>
        <Flourish mirrored />
      </span>
    );
  } else if (showHint) {
    content = singlePage
      ? 'Swipe to turn the page. Tap a photograph to see it larger.'
      : 'Drag a page corner, or use the ← → keys. Tap a photograph to see it larger.';
  }
  return (
    <p ref={ref} className={`guide-line${visible && content ? ' is-visible' : ''}`}>
      {content ?? ' '}
    </p>
  );
});

export default EmptyState;
