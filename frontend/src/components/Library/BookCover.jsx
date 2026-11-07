'use client';

import { memo, useEffect, useRef } from 'react';
import { COVER_ASPECT, coverArtReady, drawCoverColour } from '@/lib/album/surfaces';

const COVER_PIXEL_WIDTH = 440;

/**
 * A small physical-looking book, built in CSS 3D with the same cover art as the WebGL
 * book. A page can hold any number of these, whereas giving each its own WebGL scene
 * would soon hit the browser's limit on 3D contexts. Thickness follows the photo count.
 */
const BookCover = memo(function BookCover({ title, theme, photoCount = 0, size = 'normal' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    coverArtReady().then(() => {
      if (cancelled || !canvasRef.current) return;
      drawCoverColour(canvasRef.current, { title, hingeLeft: true, theme });
    });
    return () => {
      cancelled = true;
    };
  }, [title, theme]);

  const thickness = Math.min(30, 12 + photoCount * 0.45);
  const [r, g, b] = theme.paperInfo.rgb;

  return (
    <div
      className={`book book-${size}`}
      style={{
        '--book-t': `${thickness}px`,
        '--book-cover': theme.colourInfo.css,
        '--book-paper': `rgb(${r},${g},${b})`,
        '--book-ribbon': theme.colourInfo.ribbon,
      }}
    >
      <div className="book-shadow" />
      <div className="book-body">
        <div className="book-back" />
        <div className="book-spine" />
        <div className="book-pages-foot" />
        <div className="book-pages-head" />
        <div className="book-pages-fore" />
        <div className="book-page" />
        <div className="book-ribbon" />
        <div className="book-front">
          <canvas
            ref={canvasRef}
            width={COVER_PIXEL_WIDTH}
            height={Math.round(COVER_PIXEL_WIDTH * COVER_ASPECT)}
            aria-hidden="true"
          />
          <div className="book-sheen" />
        </div>
      </div>
    </div>
  );
});

export default BookCover;
