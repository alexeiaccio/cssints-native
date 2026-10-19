import baseUi from '../vendor/specs/scenarios/apg/slider.base-ui.json';
import definition from '../vendor/specs/src/apg/slider.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/slider.react-aria.json';
import {
  sliderBridge,
  sliderConfig,
  sliderProbe,
  sliderSteps,
} from '../vendor/specs/src/apg/slider.bridge';
import { conformance } from './conformance';
import { mountSlider } from './mounts';

conformance({
  pattern: 'slider',
  scenarioFiles: [baseUi, reactAria],
  definition,
  bridge: sliderBridge,
  config: sliderConfig,
  mount: mountSlider,
  disabledAttr: 'aria-disabled',
  steps: sliderSteps,
  probe: sliderProbe,
  // The spec's variant table fixes the range (0..10) and two step/large-step
  // pairs, so most ported scenarios are unsupported rather than divergent.
  divergences: {},
  expected: { passed: 1, unsupported: 51 },
  // uncontrolled, then vertical, right-to-left, both, then a controlled host
  // that accepts every request or pins the value (rejects), the last one while
  // vertical. The step-2 variants make a walk notice an arrow that ignores
  // `step` (eoa's walk configs).
  walks: [
    {},
    { orientation: 'vertical' },
    { dir: 'rtl' },
    { orientation: 'vertical', dir: 'rtl' },
    { step: 2, largeStep: 4 },
    { step: 2, largeStep: 4, dir: 'rtl' },
    { controlled: true },
    { controlled: true, value: 5 },
    { controlled: true, orientation: 'vertical' },
    { controlled: true, step: 2, largeStep: 4, value: 6 },
  ],
});
