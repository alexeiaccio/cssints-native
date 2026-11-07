// A file pane in cells: the query's captures, one row a line.
import type { Style } from "cssints";

const MAX_ROWS = 24;
const pill: Style = css.cn(css.width(200), css.bg(t.color.surface));

export function Units(props: { value: number }) {
  const label = `${props.value} g`;
  return <button class="pill" onClick={() => props.onChange(1)}>
    {label}
  </button>;
}
