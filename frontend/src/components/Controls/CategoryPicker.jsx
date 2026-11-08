'use client';

import CategoryIcon from '@/components/UI/CategoryIcon';
import { CATEGORIES, CATEGORY_ORDER } from '@/lib/album/categories';

/** Which collection an album belongs to, as two cards to choose between. */
export default function CategoryPicker({ value, onChange }) {
  return (
    <fieldset className="category-picker">
      <legend>Collection</legend>
      <div className="category-options">
        {CATEGORY_ORDER.map((id) => {
          const category = CATEGORIES[id];
          const chosen = value === id;
          return (
            <label key={id} className={`category-option${chosen ? ' is-chosen' : ''}`}>
              <input type="radio" name="album-category" value={id} checked={chosen} onChange={() => onChange(id)} />
              <span className="category-mark">
                <CategoryIcon category={id} size={24} />
              </span>
              <span className="category-words">
                <span className="category-name">{category.name}</span>
                <span className="category-text">{category.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
