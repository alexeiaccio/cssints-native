import type { ActionStep } from '../vendor/specs/src/scenario';
import apg from '../vendor/specs/scenarios/apg/treeview.apg.json';
import {
  treeviewBridge,
  treeviewConfig,
  treeviewProbe,
  treeviewSteps,
} from '../vendor/specs/src/apg/treeview.bridge';
import definition from '../vendor/specs/src/apg/treeview.model.generated.json';
import { conformance } from './conformance';
import { mountTreeview } from './mounts';

// Scenarios whose expectations the primitive deliberately does not meet. Each
// entry must still fail (so closing the gap forces removing it) and says why.
const FOCUS_ON_ENTRY =
  'APG focuses the selected node when the tree receives focus; the treeview spec (and the primitive) keep the roving node instead.';

// Type-ahead is not ported, so the walk draws no `type` / `typeaheadReset` step
// (the four scenarios that use them are unsupported, not failing).
const TYPED = new Set(['type', 'typeaheadReset']);
const steps: ReadonlyArray<ActionStep> = treeviewSteps.filter(
  (step) => !TYPED.has(step.event),
);

conformance({
  pattern: 'treeview',
  scenarioFiles: [apg],
  definition,
  bridge: treeviewBridge,
  config: treeviewConfig,
  mount: mountTreeview,
  disabledAttr: 'aria-disabled',
  // the treeview scenarios expect each step's events, as eoa's DOM driver reported them
  readEvents: 'consumed',
  steps,
  probe: treeviewProbe,
  divergences: {
    'treeview.apg.focus-selected-node': FOCUS_ON_ENTRY,
    'treeview.apg.focus-first-selected-node-multi-select': FOCUS_ON_ENTRY,
  },
  expected: { passed: 26, unsupported: 7 },
  // eoa's eight configs: uncontrolled single and multi, a pinned selection and
  // roving node, then a controlled host that accepts every request, one that
  // holds the value (rejects), the same in multi-select, and both pinned
  walks: [
    {},
    { multiSelectable: true },
    {
      multiSelectable: true,
      expanded: ['0', '0/0'],
      selected: ['treeitem:1', 'treeitem:0/0/1'],
      focus: 'treeitem:0/0/0',
    },
    { controlled: true, accepts: true },
    { controlled: true, accepts: false },
    { controlled: true, accepts: true, multiSelectable: true },
    {
      controlled: true,
      accepts: true,
      expanded: ['0'],
      selected: ['treeitem:0/0'],
    },
    {
      controlled: true,
      accepts: false,
      expanded: ['0'],
      selected: ['treeitem:0/0'],
    },
  ],
});
