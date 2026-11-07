'use client';

import { useRef } from 'react';

export default function UploadButton({ onFiles, disabled, className = '', children }) {
  const inputRef = useRef(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {children}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        data-testid="photo-input"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          // Otherwise choosing the same file twice in a row would not fire a change.
          event.target.value = '';
        }}
      />
    </>
  );
}
