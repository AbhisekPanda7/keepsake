'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import BookCover from '@/components/Library/BookCover';
import { formatDay } from '@/lib/album/photoInfo';
import { COVER_COLOURS, COVER_MATERIALS, DEFAULT_THEME, PAPERS, THEME_PRESETS, normalizeTheme, resolveTheme } from '@/lib/album/themes';
import { DEFAULT_TITLE, MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '@/lib/storage/albumStore';

function Choices({ legend, options, value, onChange, renderMark }) {
  return (
    <fieldset className="choices">
      <legend>{legend}</legend>
      <div className="choices-row">
        {Object.entries(options).map(([id, option]) => (
          <label key={id} className={`choice${value === id ? ' is-chosen' : ''}`} title={option.name}>
            <input type="radio" name={legend} value={id} checked={value === id} onChange={() => onChange(id)} />
            {renderMark?.(option)}
            <span className={renderMark ? 'visually-hidden' : ''}>{option.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Creating an album and changing one are the same form. The book beside it shows every
 * choice as it is made, so you are choosing how the album looks rather than filling in
 * settings. `album` is null when creating.
 */
export default function AlbumEditor({ album, onSave, onCancel }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const creating = !album;
  const [title, setTitle] = useState(album?.title ?? '');
  const [description, setDescription] = useState(album?.description ?? '');
  const [theme, setTheme] = useState(() => normalizeTheme(album?.theme ?? DEFAULT_THEME));

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.select();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  const setPart = (part) => (value) => setTheme((current) => ({ ...current, [part]: value }));
  const heading = creating ? 'A new album' : 'Album details';

  return (
    <dialog
      ref={ref}
      className="album-editor"
      aria-labelledby="album-editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        className="album-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ title, description, theme });
        }}
      >
        <div className="album-editor-preview">
          <BookCover
            title={title.trim() || DEFAULT_TITLE}
            theme={resolved}
            photoCount={album?.photoCount ?? album?.photos?.length ?? 0}
            size="large"
          />
          <p className="album-editor-date">
            {creating ? `Begun ${formatDay(Date.now())}` : `Begun ${formatDay(album.createdAt)}`}
          </p>
        </div>

        <div className="album-editor-fields">
          <h2 id="album-editor-heading">{heading}</h2>

          <label className="field">
            <span>Title</span>
            <input
              ref={inputRef}
              name="album-title"
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder={DEFAULT_TITLE}
              autoComplete="off"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <label className="field">
            <span>A few words, if you like</span>
            <textarea
              name="album-description"
              rows={2}
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              placeholder="Printed on the title page"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          {creating && (
            <fieldset className="choices">
              <legend>Start from</legend>
              <div className="choices-row">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className={`choice preset${resolved.key === resolveTheme(preset.theme).key ? ' is-chosen' : ''}`}
                    onClick={() => setTheme(preset.theme)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <Choices
            legend="Cover colour"
            options={COVER_COLOURS}
            value={theme.colour}
            onChange={setPart('colour')}
            renderMark={(option) => <span className="swatch" style={{ background: option.css }} />}
          />
          <Choices legend="Cover material" options={COVER_MATERIALS} value={theme.material} onChange={setPart('material')} />
          <Choices
            legend="Paper"
            options={PAPERS}
            value={theme.paper}
            onChange={setPart('paper')}
          />

          <div className="dialog-actions">
            <button type="button" className="paper-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="paper-btn solid">
              {creating ? 'Create album' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
