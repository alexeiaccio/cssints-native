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
  // The spec fixes one configuration (range 0..10, step 1, value 5), so most
  // ported scenarios are unsupported rather than divergent.
  divergences: {},
  expected: { passed: 1, unsupported: 51 },
  // uncontrolled, then vertical, right-to-left, both, and a controlled host that accepts every request or pins the
  // value (rejects), the last one while vertical
  walks: [
    {},
    { orientation: 'vertical' },
    { dir: 'rtl' },
    { orientation: 'vertical', dir: 'rtl' },
    { controlled: true },
    { controlled: true, value: 5 },
    { controlled: true, orientation: 'vertical' },
  ],
});
