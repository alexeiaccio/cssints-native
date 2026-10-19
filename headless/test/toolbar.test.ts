import ariakit from '../vendor/specs/scenarios/apg/toolbar.ariakit.json';
import baseUi from '../vendor/specs/scenarios/apg/toolbar.base-ui.json';
import definition from '../vendor/specs/src/apg/toolbar.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/toolbar.react-aria.json';
import {
  toolbarBridge,
  toolbarConfig,
  toolbarProbe,
  toolbarSteps,
} from '../vendor/specs/src/apg/toolbar.bridge';
import type { ActionStep, Probe } from '../vendor/specs/src/scenario';
import { conformance } from './conformance';
import { mountToolbar } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet: a
// config or nested control the spec's fixed five-item toolbar does not model.
// Each entry must still fail (so closing the gap forces removing it).
const SKIP_DISABLED =
  'base-ui/ariakit skip disabled items in roving navigation; toolbar.qnt keeps aria-disabled items focusable (APG disabled-but-focusable)';
const COMPOSITE_TABSTOP =
  'the abstract Composite picks the first non-disabled item as the initial tab stop; toolbar.qnt starts on item 0';
const COMPOSITE_ROLE =
  'the abstract Composite role omits aria-orientation; the primitive renders role=toolbar';
const TOGGLE_GROUP =
  'Toolbar.ToggleGroup renders role=group with aria-pressed; the primitive implements the role=toolbar roving model';

// The spec's item 0 is a menu-button. The port has no menu, so the walk runs
// with a plain button there, and must never open the spec's menu: a step that
// opens it (activating item 0, clicking it, or the arrow of the other axis, which
// a menu-button takes as its open key) is left out of the alphabet. Flipping the
// orientation would turn the other arrow into one of those, so the walk keeps
// the configured orientation. Item 0's aria-haspopup and aria-expanded are the
// menu's, so the probe does not read them.
const OPENS_MENU: Readonly<Record<'horizontal' | 'vertical', ReadonlyArray<ActionStep>>> = {
  horizontal: [
    { event: 'prop', prop: 'activate' },
    { event: 'prop', prop: 'click', value: 0 },
    { event: 'prop', prop: 'key', value: { k: 'Up' } },
    { event: 'prop', prop: 'key', value: { k: 'Down' } },
    { event: 'prop', prop: 'flipOrientation' },
  ],
  vertical: [
    { event: 'prop', prop: 'activate' },
    { event: 'prop', prop: 'click', value: 0 },
    { event: 'prop', prop: 'key', value: { k: 'Left' } },
    { event: 'prop', prop: 'key', value: { k: 'Right' } },
    { event: 'prop', prop: 'flipOrientation' },
  ],
};

const sameStep = (a: ActionStep, b: ActionStep): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const probe: Probe = {
  ...toolbarProbe,
  attrs: toolbarProbe.attrs.filter(
    ([target, name]) =>
      !(target === 'item:0' && (name === 'aria-haspopup' || name === 'aria-expanded')),
  ),
};

// eoa's walk configs, with its menu-button item as a plain button
const items = ['button', 'button', 'text', 'spin', 'button'];

conformance({
  pattern: 'toolbar',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: toolbarBridge,
  config: toolbarConfig,
  mount: mountToolbar,
  disabledAttr: 'aria-disabled',
  steps: toolbarSteps,
  probe,
  alphabet: (config) => {
    const orientation = config['orientation'] === 'vertical' ? 'vertical' : 'horizontal';
    return toolbarSteps.filter(
      (step) => !OPENS_MENU[orientation].some((opens) => sameStep(step, opens)),
    );
  },
  divergences: {
    'toolbar.ariakit.skips-direct-disabled-inactive-accessible': SKIP_DISABLED,
    'toolbar.ariakit.skips-disabled-inactive-focusable': SKIP_DISABLED,
    'toolbar.ariakit.skips-disabled-inactive-focusable-below': SKIP_DISABLED,
    'toolbar.ariakit.skips-inherited-disabled-inactive-accessible': SKIP_DISABLED,
    'toolbar.base-ui.composite-navigation-skips-disabled-index': SKIP_DISABLED,
    'toolbar.base-ui.composite-disabled-indices-initial-stop': COMPOSITE_TABSTOP,
    'toolbar.base-ui.composite-no-aria-orientation': COMPOSITE_ROLE,
    'toolbar.base-ui.toggle-group-arrow-horizontal': TOGGLE_GROUP,
    'toolbar.base-ui.toggle-group-arrow-vertical': TOGGLE_GROUP,
    'toolbar.base-ui.toggle-group-enter-space-toggles': TOGGLE_GROUP,
    'toolbar.base-ui.toggle-group-role-orientation': TOGGLE_GROUP,
  },
  expected: { passed: 10, unsupported: 63 },
  walks: [
    { items, orientation: 'horizontal' },
    { items, orientation: 'vertical', loopFocus: true },
  ],
});
