'use client';

import { forwardRef } from 'react';
import UploadButton from '@/components/Controls/UploadButton';

/** The one line of guidance shown above an open book. */
const EmptyState = forwardRef(function EmptyState({ visible, isEmpty, showHint, singlePage, uploading, onFiles }, ref) {
  let content = null;
  if (isEmpty) {
    content = (
      <>
        Nothing here yet.{' '}
        <UploadButton className="text-action" onFiles={onFiles} disabled={uploading}>
          Add your first photographs
        </UploadButton>
      </>
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
