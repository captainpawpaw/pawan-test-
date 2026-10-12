import { useState } from "react";
import { normalizeTag } from "./notes.js";

// Chips for a note's tags plus an input that adds more.
// Enter or comma adds, Backspace on an empty input removes the last tag.
export default function TagEditor({ tags, suggestions, onAdd, onRemove }) {
  const [draft, setDraft] = useState("");
  const listId = "tag-suggestions";

  function commit() {
    if (normalizeTag(draft)) onAdd(draft);
    setDraft("");
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      onRemove(tags[tags.length - 1]);
    }
  }

  function onChange(e) {
    const value = e.target.value;
    // A pasted "a, b, c" adds the complete tags and keeps the last fragment.
    if (value.includes(",")) {
      const parts = value.split(",");
      onAdd(parts.slice(0, -1).join(","));
      setDraft(parts[parts.length - 1]);
    } else {
      setDraft(value);
    }
  }

  const unused = suggestions.filter((t) => !tags.includes(t));

  return (
    <div className="tag-editor">
      <span className="tag-label">Tags</span>
      {tags.map((t) => (
        <span key={t} className="tag">
          #{t}
          <button onClick={() => onRemove(t)} aria-label={`Remove tag ${t}`} title="Remove tag">×</button>
        </span>
      ))}
      <input
        id="tag-input"
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={commit}
        list={listId}
        placeholder={tags.length ? "Add another tag" : "Add a tag, press Enter"}
        aria-label="Add a tag"
      />
      <datalist id={listId}>
        {unused.map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}
