import {
  buttonBridge,
  buttonConfig,
  buttonProbe,
  buttonSteps,
} from '@cssints/apg-specs/apg/button.bridge';
import ariakit from '@cssints/apg-specs/scenarios/apg/button.ariakit.json';
import baseUi from '@cssints/apg-specs/scenarios/apg/button.base-ui.json';
import definition from '@cssints/apg-specs/apg/button.model.json';
import reactAria from '@cssints/apg-specs/scenarios/apg/button.react-aria.json';
import { conformance } from './conformance';
import { mountButton } from './mounts';

conformance({
  pattern: 'button',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: buttonBridge,
  config: buttonConfig,
  mount: mountButton,
  disabledAttr: 'aria-disabled',
  steps: buttonSteps,
  probe: buttonProbe,
  // Scenarios whose expectations the primitive deliberately does not meet. Each
  // entry must still fail (so fixing the gap forces removing it) and says why.
  divergences: {
    'button.base-ui.toggle-disabled':
      'a bare `<Toggle disabled>` with no pressed config is read as a command button (no aria-pressed) using aria-disabled, not the native disabled attribute',
    'button.react-aria.disabled-state':
      'the primitive uses aria-disabled (focusable, per the APG button text), not the native disabled attribute',
    'button.react-aria.toggle-button-disabled':
      'the primitive uses aria-disabled, not the native disabled attribute',
    'button.react-aria.hover-state-and-callbacks':
      'hover state and onHoverStart/onHoverChange/onHoverEnd are library extensions; the primitive reports activation only',
    'button.react-aria.s1-button-keyboard-activates-non-submit':
      'react-aria press handling reports onKeyDown/onKeyUp defaultPrevented; the primitive reports activation only',
    'button.react-aria.s1-toggle-button-controlled-selected':
      'react-aria pins the controlled `isSelected` value and rejects the click; the primitive models `isSelected` as a host that answers every request',
    'button.react-aria.toggle-button-selected-state':
      'the ported scenario expects `onChange` to hold only the latest payload (`[false]`); the replay engine reports every call since mount, and the primitive fires both (`[true, false]`)',
  },
  expected: { passed: 7, unsupported: 41 },
  // an uncontrolled toggle, then a controlled host that accepts every request
  // and one that pins the value (rejects), plus command buttons
  walks: [
    {},
    { toggle: true },
    { disabled: true },
    { toggle: true, disabled: true },
    { defaultPressed: true },
    { pressed: false },
    { pressed: true },
    { value: false },
    { value: true },
    { value: true, disabled: true },
  ],
});
