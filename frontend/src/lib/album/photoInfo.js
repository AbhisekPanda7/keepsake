/** Wording for what we know about photographs and albums. Pure, so it can be tested alone. */

export const MAX_CAPTION_LENGTH = 140;

function validDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 January 2024", or an empty string if the photo has no usable date. */
export function formatPhotoDate(photo, locale) {
  const date = validDate(photo?.takenAt);
  if (!date) return '';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The date to show people: only one the camera recorded. A file's modified date is usually
 * the day it was copied or shared, not the day the photo was taken, and a wrong date in a
 * keepsake is worse than none. It's still stored, in case it's useful one day.
 */
export function capturedDate(photo, locale) {
  return photo?.takenAtSource === 'exif' ? formatPhotoDate(photo, locale) : '';
}

/** Longer wording for the enlarged view. */
export function describePhotoDate(photo, locale) {
  const text = capturedDate(photo, locale);
  return text ? `Taken ${text}` : '';
}
/** A caption as stored: one line, tidy, and short enough to print on a page. */
export function normalizeCaption(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_LENGTH)
    .trim();
}

/**
 * Breaks text into at most `maxLines` lines, using `measure(text)` for width. Text that
 * doesn't fit ends with an ellipsis; a single word too long for a line is cut.
 */
export function wrapText(text, measure, maxWidth, maxLines) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let index = 0;
  while (index < words.length && lines.length < maxLines) {
    const candidate = line ? `${line} ${words[index]}` : words[index];
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      index += 1;
    } else if (line) {
      lines.push(line);
      line = '';
    } else {
      lines.push(words[index]);
      index += 1;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  const overflowed = index < words.length;
  const last = lines.length - 1;
  if (last < 0) return lines;
  if (overflowed || measure(lines[last]) > maxWidth) {
    let tail = lines[last];
    while (tail.length > 1 && measure(`${tail}…`) > maxWidth) tail = tail.slice(0, -1);
    lines[last] = `${tail.trimEnd()}…`;
  }
  return lines;
}

/** "1 photograph", "12 photographs", "Empty". */
export function photoCountText(count) {
  if (!count) return 'Empty';
  return `${count} ${count === 1 ? 'photograph' : 'photographs'}`;
}

/** A calendar date for album details. */
export function formatDay(timestamp, locale) {
  const date = validDate(timestamp);
  return date ? date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** "today", "yesterday", "3 days ago", then the date itself. Counted in calendar days. */
export function formatUpdated(timestamp, now = Date.now(), locale) {
  const date = validDate(timestamp);
  if (!date) return '';
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
