import {
  radioBridge,
  radioConfig,
  radioProbe,
  radioSteps,
} from '@cssints/apg-specs/apg/radio.bridge';
import ariakit from '@cssints/apg-specs/scenarios/apg/radio.ariakit.json';
import baseUi from '@cssints/apg-specs/scenarios/apg/radio.base-ui.json';
import definition from '@cssints/apg-specs/apg/radio.model.json';
import reactAria from '@cssints/apg-specs/scenarios/apg/radio.react-aria.json';
import { conformance } from './conformance';
import { mountRadio } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
const NATIVE_ATTR =
  'react-aria renders a native <input type=radio>; the primitive exposes role=radio + aria-checked (APG) instead of the HTML disabled attribute';
const PER_RADIO_CALLBACKS =
  'the upstream test uses per-radio onFocusA/onBlurA callbacks; the primitive reports one onFocus/onBlur with the radio target';

// Config remounts (`preselect` / `disabled`) write the uncontrolled local and
// have no controlled-host equivalent in the walk. `flavor` is left out of every
// walk: only the roving flavour is ported.
const CONFIG_PROPS = new Set(['preselect', 'disabled']);

conformance({
  pattern: 'radio',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: radioBridge,
  config: radioConfig,
  mount: mountRadio,
  disabledAttr: 'aria-disabled',
  disabledReads: 'token',
  steps: radioSteps,
  probe: radioProbe,
  alphabet: (config) =>
    radioSteps.filter(
      (step) =>
        step.prop !== 'flavor' &&
        (config['controlled'] !== true || step.prop === undefined || !CONFIG_PROPS.has(step.prop)),
    ),
  divergences: {
    'radio.react-aria.disabled-radio-state': NATIVE_ATTR,
    'radio.react-aria.focus-moves-between-radios-fires-blur': PER_RADIO_CALLBACKS,
  },
  expected: { passed: 18, unsupported: 36 },
  // uncontrolled, then a controlled host that accepts every request and one that pins the value (rejects)
  walks: [
    { items: 4, values: ['0', '1', '2', '3'] },
    { items: 4, values: ['0', '1', '2', '3'], checked: 'radio:1' },
    { items: 4, values: ['0', '1', '2', '3'], disabled: [1, 2] },
    { items: 4, values: ['0', '1', '2', '3'], controlled: true, checked: 'radio:0' },
    { items: 4, values: ['0', '1', '2', '3'], controlled: true, value: 2 },
  ],
});
