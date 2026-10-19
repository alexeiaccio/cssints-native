import {
  switchBridge,
  switchConfig,
  switchProbe,
  switchSteps,
} from '../vendor/specs/src/apg/switch.bridge';
import baseUi from '../vendor/specs/scenarios/apg/switch.base-ui.json';
import definition from '../vendor/specs/src/apg/switch.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/switch.react-aria.json';
import { conformance } from './conformance';
import { mountSwitch } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
const NATIVE_ATTR =
  'react-aria renders a native input; the primitive exposes role=switch + aria-checked (APG) instead of the checked attribute';
const ANCESTOR_EVENT =
  'base-ui reports onClick/onClickCapture to ancestors; the primitive only owns the switch callbacks';

conformance({
  pattern: 'switch',
  scenarioFiles: [baseUi, reactAria],
  definition,
  bridge: switchBridge,
  config: switchConfig,
  mount: mountSwitch,
  disabledAttr: 'aria-disabled',
  steps: switchSteps,
  probe: switchProbe,
  divergences: {
    'switch.base-ui.onclick-called': ANCESTOR_EVENT,
    'switch.base-ui.click-propagates-once': ANCESTOR_EVENT,
    'switch.react-aria.disabled-state': NATIVE_ATTR,
    'switch.react-aria.selected-state-onchange': NATIVE_ATTR,
    'switch.react-aria.s1-switch-disabled': NATIVE_ATTR,
    'switch.react-aria.s1-switch-read-only': NATIVE_ATTR,
  },
  expected: { passed: 8, unsupported: 28 },
  // an uncontrolled switch, then a controlled host that accepts every request
  // and one that pins the value (rejects), plus the optional Enter key
  walks: [
    {},
    { defaultChecked: true },
    { disabled: true },
    { enterToggles: true },
    { enterToggles: true, defaultChecked: true },
    { checked: false },
    { checked: true },
    { isSelected: false },
    { isSelected: true, disabled: true },
  ],
});
