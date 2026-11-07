// The storybook page: a rail of the stories `@cssints/stories` reads, the picked one in the canvas, and the controls the
// story declares under it. The rail is a vertical tablist (the native headless tabs, the Widgets page's part): one Tab
// stop, Up and Down move the roving focus and (automatic activation) pick the story the canvas draws — the same loader
// the web site reads.
//
// The controls panel is one row per declared arg, each a native headless part: a `boolean` is a switch, a `select` a
// vertical radio group, a `number` or `range` a slider (min, max and step from the control), a `text` a text field. A
// control writes the arg, and the canvas is keyed on the story and its args, so a changed arg mounts the story again with
// the new args (a story is a function of its args; the parts it registered leave the focus manager with it). Every row is
// a Tab stop of the page's manager, after the rail and after the story's own controls (the canvas is drawn first).
//
//   bun solid/main.ts storybook                 a window, the first story picked
//   bun solid/main.ts storybook --story widgets--switch  one story, for a frame or a stored golden
//   bun solid/main.ts storybook --arg on=true --arg label=Wi-Fi  an arg's starting value, as the control writes it
import * as css from "cssints/clay" with { type: "cssints" };
import { createSignal, getOwner, onCleanup, Show } from "solid-js";

import { entries, type Args, type ArgTypes, type Control } from "@cssints/stories";

import {
  createRadioGroup,
  createSlider,
  createSwitch,
  createTabs,
  createTextField,
} from "../../headless/src/index.ts";
import { a11y } from "../a11y.ts";
import { pageEntry, type Motion } from "../src/entry.ts";
import type { Input } from "../src/input.ts";
import type { Node } from "../src/renderer.ts";
import { modules } from "../stories/index.ts";

// no registry: the item is the file's own name, so `pages.stories.tsx` gives `pages--inline`
const stories = entries<Node>(modules, (path) =>
  path.slice("./".length, -".stories.tsx".length),
);

/** The page's own size: a rail, a canvas wide enough for a 360 page, and the controls panel under both. */
export const size = { width: 720, height: 560 };

const t = css.createTokens({
  color: {
    $type: "color",
    page: { $value: "rgb(16 18 24)" },
    surface: { $value: "rgb(36 40 52)" },
    ink: { $value: "rgb(235 235 240)" },
    muted: { $value: "rgb(150 155 170)" },
    accent: { $value: "rgb(240 140 50)" },
    off: { $value: "rgb(60 64 78)" },
    hover: { $value: "rgb(48 53 68)" },
    ring: { $value: "rgb(90 170 255)" },
    thumb: { $value: "rgb(255 255 255)" },
    selection: { $value: "rgb(240 140 50 / 0.30)" },
  },
});
css.createGlobalTheme(t, "light", {
  color: {
    page: "rgb(244 245 248)",
    surface: "rgb(255 255 255)",
    ink: "rgb(25 27 34)",
    muted: "rgb(95 100 115)",
    accent: "rgb(190 90 10)",
    off: "rgb(190 194 206)",
    hover: "rgb(232 235 241)",
    ring: "rgb(20 100 220)",
    thumb: "rgb(255 255 255)",
    selection: "rgb(190 90 10 / 0.22)",
  },
});
const font = css.fonts("Roboto");

const root = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.gap(12),
  css.p(16),
  css.bg(t.color.page),
);
const rail = css.cn(
  css.width(220),
  css.height("stretch"),
  css.gap(4),
  css.p(8),
  css.flexDirection("column"),
  css.borderRadius(10),
  css.bg(t.color.surface),
);
const row = css.cn(
  css.width("stretch"),
  css.p(8, 10),
  css.borderRadius(8),
  css.hover(css.bg(t.color.hover)),
  css.focus(css.border(2, t.color.ring)),
);
const rowOn = css.cn(row, css.bg(t.color.hover));
const label = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(13));
const labelOn = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(13));
const caption = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(12));
const canvas = css.cn(
  css.width("stretch"),
  css.height("stretch"),
  css.p(8),
  css.gap(8),
  css.flexDirection("column"),
  css.alignItems("center"),
  css.bg(t.color.page),
);

// The controls panel: a row per arg, on the rail's surface. A row that is a part's own box (a switch, a radio, a text
// field) takes the focus ring; a slider's ring is the theme's (`rail`), as on the Widgets page, so the knob and the
// readout sit outside it.
const panel = css.cn(
  css.width(420),
  css.p(10, 12),
  css.gap(8),
  css.flexDirection("column"),
  css.borderRadius(10),
  css.bg(t.color.surface),
);
const controlRow = css.cn(
  css.width("stretch"),
  css.p(3, 6),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(6),
  css.hover(css.bg(t.color.hover)),
  css.focus(css.border(2, t.color.ring)),
);
const fieldRow = css.cn(css.width("stretch"), css.gap(8), css.alignItems("center"));
const block = css.cn(css.width("stretch"), css.gap(3), css.flexDirection("column"));
const controlLabel = css.cn(font.Roboto, css.color(t.color.muted), css.fontSize(12), css.width(84));
const controlValue = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(12));

const track = css.cn(
  css.width(36),
  css.height(20),
  css.p(2),
  css.borderRadius(10),
  css.alignItems("center"),
  css.justifyContent("flex-start"),
  css.bg(t.color.off),
);
const trackOn = css.cn(track, css.bg(t.color.accent), css.justifyContent("flex-end"));
const thumb = css.cn(css.width(16), css.height(16), css.borderRadius(8), css.bg(t.color.thumb));

const choices = css.cn(css.width("stretch"), css.gap(2), css.flexDirection("column"));
const choice = css.cn(
  css.width("stretch"),
  css.p(3, 6),
  css.gap(8),
  css.alignItems("center"),
  css.borderRadius(6),
  css.hover(css.bg(t.color.hover)),
  css.focus(css.border(2, t.color.ring)),
);
const ring = css.cn(
  css.width(14),
  css.height(14),
  css.borderRadius(7),
  css.border(2, t.color.muted),
  css.justifyContent("center"),
  css.alignItems("center"),
);
const ringOn = css.cn(ring, css.borderColor(t.color.accent));
const dot = css.cn(css.width(6), css.height(6), css.borderRadius(3), css.bg(t.color.accent));

const sliderRow = css.cn(css.gap(4), css.alignItems("center"), css.borderRadius(8));
const sliderRail = css.cn(
  css.width(120),
  css.height(20),
  css.alignItems("center"),
  css.borderRadius(8),
  css.focus(css.border(2, t.color.ring)),
);
const fill = css.cn(css.height(4), css.borderRadius(2), css.bg(t.color.accent));
const slack = css.cn(css.width("stretch"), css.height(4), css.borderRadius(2), css.bg(t.color.off));
const knob = css.cn(
  css.width(14),
  css.height(14),
  css.borderRadius(7),
  css.bg(t.color.thumb),
  css.border(2, t.color.muted),
);
const readout = css.cn(css.width(56), css.justifyContent("flex-end"));

const textBox = css.cn(
  css.width("stretch"),
  css.height(30),
  css.p(6, 8),
  css.alignItems("center"),
  css.bg(t.color.page),
  css.borderRadius(6),
  css.border(1, t.color.muted),
  css.focus(css.border(2, t.color.ring)),
);
const textLine = css.cn(css.alignItems("center"));
const textValue = css.cn(font.Roboto, css.color(t.color.ink), css.fontSize(12), css.whiteSpace("nowrap"));
const caret = css.cn(css.width(1), css.height(14), css.bg(t.color.ink));
const selection = css.cn(css.bg(t.color.selection));

const KNOB = 14;
// the slider's filled part is as wide as its value: the one style made at run time, kept per width (the Widgets page's)
const fills = new Map<number, typeof fill>();
const fillOf = (w: number): typeof fill => {
  let style = fills.get(w);
  if (!style) {
    const base = fill as any;
    const width = { type: "FIXED", min: w, max: w };
    fills.set(w, (style = { ...base, layout: { ...base.layout, sizing: { ...base.layout.sizing, width } } }));
  }
  return style!;
};

/** The width a press on a rail at this px sets: 0..1 along the rail less the knob (a `ui.bounds` read). */
const ratioAt = (railId: string, x: number): number => {
  const [left, , width] = ui.bounds(Buffer.from(railId)) ?? [0, 0, 0];
  if (width! <= KNOB) return 0;
  return Math.max(0, Math.min(1, (x - left! - KNOB / 2) / (width! - KNOB)));
};

/**
 * The value as a text field's row shows it: the runs before and after the selection, the selection in a tinted box, and
 * the 1px caret between them while the field has focus (the Field page's `Content`, without the readout).
 */
function FieldText(props: { id: string; field: ReturnType<typeof createTextField> }) {
  const text = () => props.field.value();
  const selectionOf = () => props.field.selection();
  const caretAt = () => props.field.caret();
  const before = () => props.field.focused() && caretAt() === selectionOf().start;
  return (
    <box id={`${props.id}-line`} style={textLine}>
      <Show when={selectionOf().start > 0}>
        <text style={textValue}>{text().slice(0, selectionOf().start)}</text>
      </Show>
      <Show when={before()}>
        <box id={`${props.id}-caret`} style={caret} />
      </Show>
      <Show when={selectionOf().start < selectionOf().end}>
        <box style={selection}>
          <text style={textValue}>{text().slice(selectionOf().start, selectionOf().end)}</text>
        </box>
      </Show>
      <Show when={!before() && props.field.focused()}>
        <box id={`${props.id}-caret`} style={caret} />
      </Show>
      <Show when={selectionOf().end < text().length}>
        <text style={textValue}>{text().slice(selectionOf().end)}</text>
      </Show>
    </box>
  );
}

function BoolControl(props: {
  input: Input;
  name: string;
  id: string;
  start: boolean;
  write: (value: boolean) => void;
}) {
  const sw = createSwitch({ id: props.id, defaultValue: props.start, onValueChange: props.write });
  const bind = props.input.add(sw.part);
  onCleanup(() => props.input.focus.unregister(props.id));
  return (
    <box {...bind} {...a11y(sw.part)} labelledBy={`${props.id}-label`} style={controlRow}>
      <text id={`${props.id}-label`} style={controlLabel}>
        {props.name}
      </text>
      <box style={sw.checked() ? trackOn : track}>
        <box style={thumb} />
      </box>
      <text style={controlValue}>{sw.checked() ? "on" : "off"}</text>
    </box>
  );
}

function ChoiceControl(props: {
  input: Input;
  name: string;
  id: string;
  options: ReadonlyArray<string>;
  start: string | undefined;
  write: (value: string) => void;
}) {
  // the options are the arg's values, so the group is a vertical radio group of them (the Widgets page's Speed group)
  const group = createRadioGroup({
    id: props.id,
    values: props.options,
    defaultValue: props.start,
    orientation: "vertical",
    focus: props.input.focus,
    onValueChange: props.write,
  });
  const bind = group.radios.map((radio) => props.input.bind(radio));
  return (
    <box style={block}>
      <text id={`${props.id}-label`} style={controlLabel}>
        {props.name}
      </text>
      <box {...a11y(group.group)} labelledBy={`${props.id}-label`} style={choices}>
        {group.radios.map((radio, at) => (
          <box {...bind[at]!} {...a11y(radio)} style={choice}>
            <box style={radio.checked ? ringOn : ring}>
              <Show when={radio.checked}>
                <box style={dot} />
              </Show>
            </box>
            <text style={controlValue}>{props.options[at]}</text>
          </box>
        ))}
      </box>
    </box>
  );
}

function NumberControl(props: {
  input: Input;
  name: string;
  id: string;
  min: number;
  max: number;
  step: number;
  start: number;
  write: (value: number) => void;
}) {
  const slider = createSlider({
    id: props.id,
    min: props.min,
    max: props.max,
    step: props.step,
    largeStep: props.step * 4,
    defaultValue: Math.max(props.min, Math.min(props.max, props.start)),
    focus: props.input.focus,
    // the readout is the arg's number, not the default low/medium/high prose: a control shows the value it writes
    valueText: (value) => String(value),
    onValueChange: props.write,
  });
  const bind = props.input.bind(slider.thumb);
  const railId = `${props.id}-rail`;
  // a press sets the value from where it lands and focuses the thumb; a drag is not wired (a key steps, a press jumps)
  const press = (x: number) => slider.pointer(ratioAt(railId, x));
  const filled = () => ((slider.value() - props.min) / (props.max - props.min)) * (120 - KNOB);
  return (
    <box style={fieldRow}>
      <text id={`${props.id}-label`} style={controlLabel}>
        {props.name}
      </text>
      <box {...a11y(slider.thumb)} labelledBy={`${props.id}-label`} style={sliderRow}>
        <box id={railId} focused={bind.focused} onPress={press} style={sliderRail}>
          <box style={fillOf(filled())} />
          <box style={knob} />
          <box style={slack} />
        </box>
        <box style={readout}>
          <text style={controlValue}>{slider.thumb.valueText}</text>
        </box>
      </box>
    </box>
  );
}

function TextControl(props: {
  input: Input;
  name: string;
  id: string;
  start: string;
  write: (value: string) => void;
}) {
  const field = createTextField({
    id: props.id,
    defaultValue: props.start,
    focus: props.input.focus,
    onValueChange: props.write,
  });
  // the caret starts after the arg's text, so Tab into the field and typing appends to it (a DOM input's caret on click)
  field.setCaret(props.start.length);
  // the field's own press places the caret at 8px a character; this one measures the run's width (the Field page's)
  const { onClick: _press, ...bind } = props.input.bind(field.part);
  const press = (x: number) => {
    const [left, , width] = ui.bounds(Buffer.from(`${props.id}-line`)) ?? [0, 0, 0];
    const length = field.value().length;
    field.press(x - left!, length > 0 ? width! / length : undefined);
  };
  return (
    <box style={block}>
      <text id={`${props.id}-label`} style={controlLabel}>
        {props.name}
      </text>
      <box {...bind} {...a11y(field.part)} labelledBy={`${props.id}-label`} onClick={press} style={textBox}>
        <FieldText id={props.id} field={field} />
      </box>
    </box>
  );
}

/** One declared control, as the native headless part that takes its value. */
function ControlRow(props: {
  input: Input;
  name: string;
  control: Control;
  start: unknown;
  write: (value: unknown) => void;
}) {
  const id = `arg-${props.name}`;
  const c = props.control;
  if (c.type === "boolean") {
    return (
      <BoolControl
        input={props.input}
        name={props.name}
        id={id}
        start={props.start === true}
        write={props.write}
      />
    );
  }
  if (c.type === "select") {
    const start = typeof props.start === "string" ? props.start : undefined;
    return (
      <ChoiceControl
        input={props.input}
        name={props.name}
        id={id}
        options={c.options}
        start={start}
        write={(value) => props.write(value)}
      />
    );
  }
  if (c.type === "text") {
    return (
      <TextControl
        input={props.input}
        name={props.name}
        id={id}
        start={typeof props.start === "string" ? props.start : ""}
        write={(value) => props.write(value)}
      />
    );
  }
  // `number` and `range`: the slider, with the control's bounds. A number with none is 0..100 (a slider needs a range).
  const start = typeof props.start === "number" ? props.start : (c.min ?? 0);
  return (
    <NumberControl
      input={props.input}
      name={props.name}
      id={id}
      min={c.min ?? 0}
      max={c.max ?? 100}
      step={c.step ?? 1}
      start={start}
      write={(value) => props.write(value)}
    />
  );
}

/** The panel: a row per declared arg, in the order the story declares them, from the args the story mounts with: a
 * control owns its value from then on (and writes the arg it stands for). */
function Controls(props: {
  input: Input;
  argTypes: ArgTypes;
  start: Args;
  write: (name: string, value: unknown) => void;
}) {
  return (
    <box id="controls" style={panel}>
      <text style={caption}>Controls</text>
      {Object.entries(props.argTypes).map(([name, control]) => (
        <ControlRow
          input={props.input}
          name={name}
          control={control}
          start={props.start[name]}
          write={(value) => props.write(name, value)}
        />
      ))}
    </box>
  );
}

/**
 * `start`: the story to open. `args`: the args to start it with, `--arg name=value` each, typed by the story's declared
 * controls (so `--arg on=true` is a boolean, `--arg speed=16x` the option, `--arg volume=70` a number).
 */
export function Storybook(props: {
  input: Input;
  motion?: Motion;
  start?: string;
  args?: Record<string, string>;
}) {
  // the root is this page's own id: a story that is a page declares "Root" itself, and Clay refuses a repeated id
  pageEntry(props.motion, "Storybook");
  const open = Math.max(
    0,
    stories.findIndex((story) => story.id === props.start),
  );
  // the rail is one tablist: the tabs register in the page's focus manager themselves (`focus`), so the rail is one Tab
  // stop, entered on the selected row. The canvas is the picked story's box rather than a panel, so every panel is
  // declared focusable: Tab goes on from the rail to the story's own first control, not to an invisible panel.
  const tabs = createTabs({
    id: "stories",
    items: stories.length,
    orientation: "vertical",
    activation: "automatic",
    defaultSelected: open,
    focusablePanels: stories.map((_story, at) => at),
    focus: props.input.focus,
  });
  const bind = stories.map((_story, at) => props.input.bind(tabs.tabs[at]!));
  const picked = () => stories[tabs.selected()] ?? stories[0]!;

  // the args a control wrote, per story (a story keeps its own while the rail is elsewhere), over the story's declared
  // args; `serial` is what the canvas is keyed on besides the id, so a write mounts the story again with the new args
  const [written, setWritten] = createSignal<Record<string, Args>>(boot(stories[open], props.args));
  const [serial, setSerial] = createSignal(0);
  const argsOf = (id: string): Args => ({
    ...stories.find((story) => story.id === id)?.args,
    ...(written()[id] ?? {}),
  });
  const write = (id: string, name: string, value: unknown) => {
    setWritten((all) => ({ ...all, [id]: { ...(all[id] ?? {}), [name]: value } }));
    setSerial((n) => n + 1);
  };
  // The two keys. A mount reads its story from the key it is given and never from the rail: a read of `tabs.selected()`
  // inside a mount can still see the selection of the flush that replaced the tree (Solid 2's setters land on the next
  // flush), and the panel mounted with the previous story's args.
  const canvasKey = () => `${picked().id}:${serial()}`; // a story id holds no colon
  // a story with no declared controls gets no panel (the panel is that story's: it mounts and unmounts with it)
  const panelKey = () => (Object.keys(picked().argTypes).length > 0 ? picked().id : false);

  // The story's input is the page's, with one addition: the canvas is keyed on the story and its args, so a new arg
  // unmounts the story, and the parts it registered in the page's manager leave with it (a group or a field registers
  // itself and unregisters on its own disposal; a plain part is the page's `add`/`bind`).
  const freed = (part: { readonly id: string }): void => {
    if (getOwner() !== null) onCleanup(() => props.input.focus.unregister(part.id));
  };
  const storyInput: Input = {
    ...props.input,
    add(part, options) {
      const bound = props.input.add(part, options);
      freed(part);
      return bound;
    },
    bind(part) {
      const bound = props.input.bind(part);
      freed(part);
      return bound;
    },
  };

  return (
    <box id="Storybook" style={root}>
      <box {...a11y(tabs.tablist)} style={rail}>
        <text style={caption}>Stories</text>
        {stories.map((story, at) => (
          <box {...bind[at]!} {...a11y(tabs.tabs[at]!)} style={story.id === picked().id ? rowOn : row}>
            <text style={story.id === picked().id ? labelOn : label}>
              {`${story.title} · ${story.name}`}
            </text>
          </box>
        ))}
      </box>
      <box style={canvas}>
        <text style={caption}>{picked().id}</text>
        <Show keyed when={canvasKey()}>
          {(key) => {
            const id = key.slice(0, key.lastIndexOf(":"));
            const story = stories.find((at) => at.id === id) ?? stories[0]!;
            return story.view({ ...argsOf(id), input: storyInput, motion: props.motion });
          }}
        </Show>
        <Show keyed when={panelKey()}>
          {(id) => {
            const story = stories.find((at) => at.id === id) ?? stories[0]!;
            return (
              <Controls
                input={props.input}
                argTypes={story.argTypes}
                start={argsOf(id)}
                write={(name, value) => write(id, name, value)}
              />
            );
          }}
        </Show>
      </box>
    </box>
  );
}

/**
 * The `--arg` values as the story's args, typed by the controls it declares: `true`/`false` for a boolean, the option
 * for a select, a number for a number or a range, the string itself otherwise. An arg the story does not declare is
 * passed as the string it was given (a story may read one no control shows).
 */
function boot(story: (typeof stories)[number] | undefined, args?: Record<string, string>): Record<string, Args> {
  if (story === undefined || args === undefined) return {};
  const typed: Args = {};
  for (const [name, raw] of Object.entries(args)) {
    const control = story.argTypes[name];
    if (control?.type === "boolean") typed[name] = raw === "true";
    else if (control?.type === "number" || control?.type === "range") typed[name] = Number(raw);
    else typed[name] = raw;
  }
  return { [story.id]: typed };
}
