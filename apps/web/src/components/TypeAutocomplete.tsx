import { useId } from 'react';
import { useTopicTypes } from '../api/hooks';

/** A free-text input backed by a datalist of existing TopicType labels. */
export function TypeAutocomplete({
  value,
  onChange,
  placeholder = 'pattern, concept, problem…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const { data: types } = useTopicTypes();
  return (
    <>
      <input
        className="input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {(types ?? []).map((t) => (
          <option key={t.key} value={t.label} />
        ))}
      </datalist>
    </>
  );
}
