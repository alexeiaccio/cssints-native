import {
  dialogModalBridge,
  dialogModalConfig,
  dialogModalProbe,
  dialogModalSteps,
} from '../vendor/specs/src/apg/dialog-modal.bridge';
import ariakit from '../vendor/specs/scenarios/apg/dialog-modal.ariakit.json';
import baseUi from '../vendor/specs/scenarios/apg/dialog-modal.base-ui.json';
import definition from '../vendor/specs/src/apg/dialog-modal.model.generated.json';
import reactAria from '../vendor/specs/scenarios/apg/dialog-modal.react-aria.json';
import { conformance } from './conformance';
import { mountDialogModal } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why;
// the reasons are eoa's, since the port keeps its primitive's contract.
const RICH_REASON =
  'the scenario asserts a { open, reason } (or internalOnOpenChange) payload; the primitive fires the neutral boolean onOpenChange';
const SINGLE_DIALOG =
  'the spec models a fixed four-dialog example with an example-specific initial focus (the dialog container itself or a particular field); the primitive focuses the dialog first control';
const BACKDROP_VISIBLE =
  'the scenario lists the modal backdrop in `visible`; the primitive draws a backdrop but the pattern visible state is the dialog';
const STANDALONE =
  'react-aria renders a standalone Dialog that is always visible and focused; the primitive mounts closed and names itself from a header element';
const ROLE_ALERT =
  'react-aria defaults this overlay to role=alertdialog; the primitive defaults to role=dialog and only takes alertdialog from config';
const CONTROLLED_FOCUS =
  'the scenario drives Escape / an outside click at the non-focusable dialog container, which the shared driver focuses first; the primitive keeps its own control focused, so the asserted focus target differs (the dialog correctly stays open)';
const DIVERGENCES: Readonly<Record<string, string>> = {
  'dialog-modal.ariakit.nested-cart-show-and-focus-dismiss': SINGLE_DIALOG,
  'dialog-modal.ariakit.controlled-outside-click-keeps-dialog-open':
    CONTROLLED_FOCUS,
  'dialog-modal.base-ui.final-focus-per-close-type': SINGLE_DIALOG,
  'dialog-modal.base-ui.onopenchange-reason-trigger-and-close': RICH_REASON,
  'dialog-modal.base-ui.escape-close-reason': RICH_REASON,
  'dialog-modal.base-ui.backdrop-click-reason': RICH_REASON,
  'dialog-modal.base-ui.escape-single-internal-openchange': RICH_REASON,
  'dialog-modal.base-ui.close-after-closed-does-not-request-again': RICH_REASON,
  'dialog-modal.base-ui.modal-inerts-page': BACKDROP_VISIBLE,
  'dialog-modal.base-ui.internal-backdrop-when-modal': BACKDROP_VISIBLE,
  'dialog-modal.react-aria.base-role-dialog': STANDALONE,
  'dialog-modal.react-aria.dialog-does-not-autofocus-inner-content': STANDALONE,
  'dialog-modal.react-aria.dialog-autofocuses-itself-without-focusable-child':
    SINGLE_DIALOG,
  'dialog-modal.react-aria.use-dialog-focuses-overlay-on-mount': SINGLE_DIALOG,
  'dialog-modal.react-aria.modal-role-and-labelledby': ROLE_ALERT,
  'dialog-modal.react-aria.restore-focus-to-trigger-on-close': SINGLE_DIALOG,
  'dialog-modal.react-aria.escape-disabled-keeps-dialog-open': SINGLE_DIALOG,
};

conformance({
  pattern: 'dialog-modal',
  scenarioFiles: [ariakit, baseUi, reactAria],
  definition,
  bridge: dialogModalBridge,
  config: dialogModalConfig,
  mount: mountDialogModal,
  disabledAttr: 'aria-disabled',
  steps: dialogModalSteps,
  probe: dialogModalProbe,
  divergences: DIVERGENCES,
  expected: { passed: 32, unsupported: 112 },
  // an uncontrolled dialog, one open at mount, then a controlled host that
  // holds every request, with the dialog closed and open
  walks: [
    {},
    { open: true },
    { controlled: true },
    { controlled: true, accepts: false },
    { controlled: true, open: true, accepts: false },
  ],
  hideable: ['dialog'],
});
