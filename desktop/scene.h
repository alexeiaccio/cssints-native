// A scene as a file, for a host with no JS: the same JSON `solid/scenes/*.json` holds (native/README.md, "A scene as a
// file"), read by a parser of the subset the C page can replay. A step lands on a frame (`t × 60`, rounded), as the
// Solid host's does, and the pointer, a settle and a frame boundary are the kinds this host has.
#ifndef CSSINTS_SCENE_H
#define CSSINTS_SCENE_H

#define SCENE_MAX_STEPS 64

typedef enum { SCENE_POINTER, SCENE_SETTLE, SCENE_FRAME } SceneKind;

typedef struct {
    /** The frame the step lands on: `t` seconds from the start, rounded to the nearest 1/60s. */
    int frame;
    /** Its `t`, for a message (an out-of-order step names both). */
    float t;
    SceneKind kind;
    float x, y; // pointer
    int down;   // pointer
    int frames; // settle
} SceneStep;

typedef struct {
    char name[64];
    char page[32];
    int width, height;
    int light; // theme == "light"
    int reducedMotion;
    int count;
    SceneStep steps[SCENE_MAX_STEPS];
} Scene;

/**
 * Reads and validates a scene. Returns 0, or -1 with `err` set (the caller prints it): a bad step names its index, an
 * out-of-order step names both frames, an unknown key or kind is refused rather than skipped.
 */
int scene_read(const char *path, Scene *scene, char *err, int errlen);

#endif
