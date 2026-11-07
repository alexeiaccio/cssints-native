import {
  checkboxBridge,
  checkboxConfig,
  checkboxProbe,
  checkboxSteps,
} from '@cssints/apg-specs/apg/checkbox.bridge';
import ariakit from '@cssints/apg-specs/scenarios/apg/checkbox.ariakit.json';
import baseUi from '@cssints/apg-specs/scenarios/apg/checkbox.base-ui.json';
import definition from '@cssints/apg-specs/apg/checkbox.model.json';
import reactAria from '@cssints/apg-specs/scenarios/apg/checkbox.react-aria.json';
import { conformance } from './conformance';
import { mountCheckbox } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
const NATIVE_ATTR =
  'react-aria renders a native <input type=checkbox>; the primitive exposes role=checkbox + aria-checked (APG) instead of the checked attribute';
const ANCESTOR_EVENT =
  'base-ui reports onClick to an ancestor element; the primitive only owns the checkbox callbacks';
const MANUAL_INDETERMINATE =
  'APG checks a mixed tri-state checkbox on activation; base-ui pins a manually indeterminate control so a click leaves it mixed';

conformance({
  pattern: 'checkbox',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: checkboxBridge,
  config: checkboxConfig,
  mount: mountCheckbox,
  disabledAttr: 'aria-disabled',
  steps: checkboxSteps,
  probe: checkboxProbe,
  divergences: {
    'checkbox.base-ui.onclick-propagates-once': ANCESTOR_EVENT,
    'checkbox.base-ui.indeterminate-ignores-click': MANUAL_INDETERMINATE,
    'checkbox.react-aria.disabled-state': NATIVE_ATTR,
    'checkbox.react-aria.indeterminate-state': NATIVE_ATTR,
    'checkbox.react-aria.selected-state-onchange': NATIVE_ATTR,
  },
  expected: { passed: 12, unsupported: 72 },
  // an uncontrolled checkbox, then a controlled host that accepts every request
  // and one that pins the value (rejects), in dual- and tri-state flavours
  walks: [
    {},
    { defaultChecked: true },
    { allowMixed: true },
    { indeterminate: true },
    { disabled: true },
    { checked: false },
    { checked: true },
    { value: false },
    { value: true },
    { controlled: true, indeterminate: true },
    { value: true, disabled: true },
  ],
});
