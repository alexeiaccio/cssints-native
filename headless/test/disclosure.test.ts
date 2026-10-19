import {
  disclosureBridge,
  disclosureConfig,
  disclosureProbe,
  disclosureSteps,
} from '../vendor/specs/src/apg/disclosure.bridge';
import apg from '../vendor/specs/scenarios/apg/disclosure.apg.json';
import ariakit from '../vendor/specs/scenarios/apg/disclosure.ariakit.json';
import baseUi from '../vendor/specs/scenarios/apg/disclosure.base-ui.json';
import definition from '../vendor/specs/src/apg/disclosure.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/disclosure.react-aria.json';
import { conformance } from './conformance';
import { mountDisclosure } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so fixing the gap forces removing it) and says why.
// APG makes aria-controls optional and says nothing on the other attributes.
const UNMOUNTED_PANEL =
  'base-ui unmounts the closed panel, so aria-controls is absent while collapsed; our panel stays mounted (hidden) with aria-controls always set';
const CONSUMER_ATTR =
  'react-aria forwards consumer-supplied attributes; the primitive only returns the pattern attributes';
const REDUNDANT_HIDDEN =
  'react-aria adds aria-hidden next to hidden; `hidden` already removes the panel from the accessibility tree';
const GROUP_ROLE =
  'react-aria gives the panel role=group named by the trigger; APG puts no role on the disclosure content';

conformance({
  pattern: 'disclosure',
  scenarioFiles: [apg, ariakit, baseUi, reactAria],
  definition,
  bridge: disclosureBridge,
  config: disclosureConfig,
  mount: mountDisclosure,
  disabledAttr: 'disabled',
  steps: disclosureSteps,
  probe: disclosureProbe,
  divergences: {
    'disclosure.base-ui.uncontrolled-pointer-toggle': UNMOUNTED_PANEL,
    'disclosure.base-ui.keyboard-enter-space-toggle': UNMOUNTED_PANEL,
    'disclosure.base-ui.panel-keep-mounted-visibility': UNMOUNTED_PANEL,
    'disclosure.react-aria.aria-label-heading-and-panel': CONSUMER_ATTR,
    'disclosure.react-aria.aria-attributes-collapsed': REDUNDANT_HIDDEN,
    'disclosure.react-aria.aria-attributes-expanded': REDUNDANT_HIDDEN,
    'disclosure.react-aria.ids-for-accessibility': GROUP_ROLE,
    'disclosure.base-ui.controlled-external-toggle': UNMOUNTED_PANEL,
  },
  expected: { passed: 31, unsupported: 26 },
  // an uncontrolled primitive, then a controlled host that accepts every
  // request, one that pins the value (rejects), and one that pins it while disabled
  walks: [
    {},
    { defaultExpanded: true },
    { disabled: true },
    { controlled: true, initialOpen: false },
    { controlled: true, initialOpen: true },
    { controlled: true, expanded: false },
    { controlled: true, expanded: true, disabled: true },
  ],
});
