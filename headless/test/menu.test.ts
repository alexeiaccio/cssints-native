import {
  menuButtonBridge,
  menuButtonConfig,
  menuButtonProbe,
  menuButtonSteps,
} from '../vendor/specs/src/apg/menu-button.bridge';
import {
  menuCheckableBridge,
  menuCheckableConfig,
  menuCheckableProbe,
  menuCheckableSteps,
} from '../vendor/specs/src/apg/menu-checkable.bridge';
import ariakit from '../vendor/specs/scenarios/apg/menu-button.ariakit.json';
import baseUi from '../vendor/specs/scenarios/apg/menu-button.base-ui.json';
import buttonDefinition from '../vendor/specs/src/apg/menu-button.model.generated.json';
import checkableDefinition from '../vendor/specs/src/apg/menu-checkable.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/menu-button.react-aria.json';
import { conformance } from './conformance';
import { mountCheckableMenu, mountMenuButton } from './mounts';

/** The scenario file with only the scenarios of one menu shape (eoa split them the same way). */
const only = (
  source: unknown,
  keep: (config: Record<string, unknown> | undefined) => boolean,
): unknown => {
  const file = source as {
    source: string;
    scenarios: ReadonlyArray<{ config?: Record<string, unknown> }>;
  };
  return {
    ...file,
    scenarios: file.scenarios.filter((scenario) => keep(scenario.config)),
  };
};
const isCheckable = (config: Record<string, unknown> | undefined): boolean =>
  config?.['variant'] === 'checkbox-items' || config?.['variant'] === 'radio-items';
const PLAIN_SCENARIOS = [ariakit, baseUi, reactAria].map((source) =>
  only(source, (config) => config?.['variant'] === undefined),
);
const CHECKABLE_SCENARIOS = [ariakit, baseUi, reactAria].map((source) =>
  only(source, isCheckable),
);

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
// The ported menu-button scenarios describe the upstream libraries' own
// defaults; the primitive implements the APG/Quint contract.
const MENU_POPUP_FOCUS =
  'ariakit moves focus to the popup container on pointer open; the primitive focuses the first menu item (APG)';
const MENU_OUTSIDE_SENTINEL =
  'the scenario names the part focus lands on after Tab as `outside`; the primitive reports no focused part outside the widget';
const MENU_LABEL =
  "the trigger's accessible name is owned by the consumer; the primitive does not set aria-label";
const MENU_HASPOPUP =
  'react-aria reports aria-haspopup as "true"; the primitive uses the APG value "menu"';
const MENU_DISABLED_SKIP =
  'react-aria skips disabled items during keyboard navigation; the primitive keeps disabled items focusable (APG note 1)';
const MENU_ITEM_CALLBACK =
  'react-aria names the item activation callback onAction/onPress; the primitive exposes onItemClick';
const MENU_TAB_TRAP =
  'react-aria traps focus and keeps the menu open on Tab; the primitive closes the menu and lets focus leave (APG)';
const CHECKABLE_DEFAULT =
  'ariakit defaults checkbox items to checked; the primitive follows the APG/base-ui unchecked default';
const CHECKABLE_FOCUS =
  'ariakit re-anchors navigation on each keydown target; the primitive moves relative to its own focused item';
const CHECKABLE_SKIP =
  'skipping hidden/disabled items is an ariakit store behaviour; the primitive keeps disabled items focusable';

const MENU_BUTTON_DIVERGENCES: Readonly<Record<string, string>> = {
  'menu-button.ariakit.click-opens-menu-focuses-container': MENU_POPUP_FOCUS,
  'menu-button.ariakit.tab-moves-focus-out-and-closes': MENU_OUTSIDE_SENTINEL,
  'menu-button.ariakit.disclosure-label-updates': MENU_LABEL,
  'menu-button.react-aria.trigger-aria-haspopup-and-expanded': MENU_HASPOPUP,
  'menu-button.react-aria.disabled-items-skipped-in-keyboard-navigation':
    MENU_DISABLED_SKIP,
  'menu-button.react-aria.press-events-on-items': MENU_ITEM_CALLBACK,
  'menu-button.react-aria.press-events-keyboard': MENU_ITEM_CALLBACK,
  'menu-button.react-aria.menu-containing-focus-on-tab': MENU_TAB_TRAP,
  'menu-button.react-aria.tab-away-keeps-menu-open': MENU_TAB_TRAP,
  'menu-button.ariakit.checkbox-item-toggles-on-click': CHECKABLE_DEFAULT,
  'menu-button.ariakit.syncs-boolean-items-with-menu-values': CHECKABLE_DEFAULT,
  'menu-button.ariakit.checkbox-item-toggles-on-enter': CHECKABLE_FOCUS,
  'menu-button.ariakit.values-navigation-skips-disabled-hidden': CHECKABLE_SKIP,
};

conformance({
  pattern: 'menu-button',
  scenarioFiles: PLAIN_SCENARIOS,
  definition: buttonDefinition,
  bridge: menuButtonBridge,
  config: menuButtonConfig,
  mount: mountMenuButton,
  disabledAttr: 'aria-disabled',
  steps: menuButtonSteps,
  probe: menuButtonProbe,
  divergences: MENU_BUTTON_DIVERGENCES,
  expected: { passed: 19, unsupported: 86 },
  // the spec's fixed fixture: four items with the third disabled, uncontrolled
  // (the open state has no controlled variant in this port)
  walks: [{ items: ['alpha', 'bravo', 'charlie', 'delta'], disabled: [2] }],
  hideable: ['menu'],
});

conformance({
  pattern: 'menu-checkable',
  scenarioFiles: CHECKABLE_SCENARIOS,
  definition: checkableDefinition,
  bridge: menuCheckableBridge,
  config: menuCheckableConfig,
  mount: mountCheckableMenu,
  disabledAttr: 'aria-disabled',
  steps: menuCheckableSteps,
  probe: menuCheckableProbe,
  divergences: MENU_BUTTON_DIVERGENCES,
  expected: { passed: 16, unsupported: 14 },
  // the spec's fixed mixed menu, then controlled hosts that accept and hold the
  // packed checked value
  walks: [
    { items: ['alpha', 'bravo', 'charlie', 'delta', 'echo'], variant: 'mixed' },
    {
      items: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
      variant: 'mixed',
      controlled: true,
      accepts: true,
    },
    {
      items: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
      variant: 'mixed',
      controlled: true,
      accepts: true,
      value: 7,
    },
    {
      items: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
      variant: 'mixed',
      controlled: true,
      accepts: false,
      value: 3,
    },
  ],
  hideable: ['menu'],
});
