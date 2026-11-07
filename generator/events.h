// The event kinds a generated page's transition table takes (`<page>_next(state, id, event)`), and the ABI a host and
// the table share. They are deliberately not a Clay enum: Clay's own pointer data is a per-frame *click* flag
// (CLAY_POINTER_DATA_PRESSED_THIS_FRAME), and a state machine needs the two edges apart — the press draws the element's
// :active and the release is the click.
#ifndef CSSINTS_EVENTS_H
#define CSSINTS_EVENTS_H

/** The button went down over the element: a press (the element's onPress runs; its frame is the :active look). */
#define CLAY_EVENT_PRESS 0
/** The button came up over the element the press was on: a click (its onClick runs; its frame is :hover). */
#define CLAY_EVENT_RELEASE 1

#endif
