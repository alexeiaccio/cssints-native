import ariakit from '@cssints/apg-specs/scenarios/apg/tabs.ariakit.json';
import baseUi from '@cssints/apg-specs/scenarios/apg/tabs.base-ui.json';
import definition from '@cssints/apg-specs/apg/tabs.model.json';
import reactAria from '@cssints/apg-specs/scenarios/apg/tabs.react-aria.json';
import {
  tabsBridge,
  tabsConfig,
  tabsProbe,
  tabsSteps,
} from '@cssints/apg-specs/apg/tabs.bridge';
import { conformance } from './conformance';
import { mountTabs } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so fixing the gap forces removing it) and says why.
const AXIS_ONLY =
  'the spec (and APG) maps arrows to the tablist axis only; react-aria additionally treats Left/Right as previous/next in a vertical stack';
const SKIP_DISABLED =
  'the spec and react-aria skip disabled tabs in one keypress; base-ui moves focus onto the disabled tab without activating it';
const PANEL_CONVENTION =
  'one fixture convention cannot serve both ariakit panel-tabindex files (they assume opposite panels hold focusable content)';

conformance({
  pattern: 'tabs',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: tabsBridge,
  config: tabsConfig,
  mount: mountTabs,
  disabledAttr: 'aria-disabled',
  keys: 'focused',
  steps: tabsSteps,
  probe: tabsProbe,
  divergences: {
    'tabs.react-aria.arrow-vertical': AXIS_ONLY,
    'tabs.base-ui.arrow-focuses-disabled-without-activating': SKIP_DISABLED,
    'tabs.ariakit.panel-tabindex-tabbable': PANEL_CONVENTION,
  },
  expected: { passed: 36, unsupported: 17 },
  // uncontrolled, the manual activation, vertical, a disabled tab, then a controlled host that accepts
  // every request and one that pins the value (rejects)
  walks: [
    {},
    { activation: 'manual' },
    { orientation: 'vertical' },
    { disabled: [1] },
    { controlled: true, selected: 0 },
    { controlled: true, value: 2 },
  ],
});
