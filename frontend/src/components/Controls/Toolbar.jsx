'use client';

import { forwardRef } from 'react';
import UploadButton from './UploadButton';

const Chevron = ({ flip }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M10 2.5 4.8 8l5.2 5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const Toolbar = forwardRef(function Toolbar(
  { pageText, photoCount, canPrev, canNext, canClose, uploading, onPrev, onNext, onFiles, onArrange, onEdit, onClose, onClear },
  ref,
) {
  return (
    <div ref={ref} className="toolbar" role="toolbar" aria-label="Album controls">
      <div className="toolbar-nav">
        <button type="button" className="tool icon" onClick={onPrev} disabled={!canPrev} aria-label="Previous page">
          <Chevron />
        </button>
        <span className="toolbar-page">{pageText}</span>
        <button type="button" className="tool icon" onClick={onNext} disabled={!canNext} aria-label="Next page">
          <Chevron flip />
        </button>
      </div>

      <span className="toolbar-count">
        {photoCount} {photoCount === 1 ? 'photograph' : 'photographs'}
      </span>

      <div className="toolbar-actions">
        <UploadButton className="tool strong" onFiles={onFiles} disabled={uploading}>
          <svg className="tool-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M4.5 8h3l1.4-2h6.2l1.4 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
              <circle cx="12" cy="13.2" r="3.4" />
            </g>
          </svg>
          Add<span className="tool-long"> photographs</span>
        </UploadButton>
        <button type="button" className="tool" onClick={onArrange} disabled={photoCount < 2 || uploading}>
          Arrange
        </button>
        <button type="button" className="tool" onClick={onEdit}>
          Details
        </button>
        <button type="button" className="tool" onClick={onClose} disabled={!canClose}>
          Close
        </button>
        <button type="button" className="tool quiet" onClick={onClear} disabled={photoCount === 0}>
          Clear<span className="tool-long"> album</span>
        </button>
      </div>
    </div>
  );
});

export default Toolbar;
