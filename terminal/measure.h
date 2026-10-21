#ifndef MEASURE_H
#define MEASURE_H

#include "clay.h"

/** Clay_SetMeasureTextFunction's function: code points x CELL_W, CELL_H tall. */
Clay_Dimensions term_measure_text(Clay_StringSlice text, Clay_TextElementConfig *config, void *user);

#endif
