# Hershey fonts (the spike's data)

`futural.jhf` — the Latin "Roman Simplex" set the spike draws; `cyrilc_1.jhf` — the Cyrillic set, vendored for its size
only (see the note below).

- Source: <https://github.com/kamalmostafa/hershey-fonts>, `hershey-fonts/*.jhf`, fetched 2026-11-01 from commit
  `1356bf2f83d380fcef68c887e88675eb9d445d86` of `master` (raw URLs:
  `https://raw.githubusercontent.com/kamalmostafa/hershey-fonts/master/hershey-fonts/futural.jhf`, `.../cyrilc_1.jhf`).
  That repository is Kamal Mostafa's `libhersheyfont` packaging of James Hurt's conversion of Hershey's original NTIS
  data.
- sha256:
  - `futural.jhf` `4958a1d06ea04709feb530deaab53d1efa1285d0d3e92a4a3edd74d279871ced` (3,498 bytes)
  - `cyrilc_1.jhf` `efc90ac562e2f6705fe7a84ecad273b22c3e3d3c279b0beeca9641ebbca02c24` (6,240 bytes)
- Licence (the exact statements found in the distribution, `README.md` and `hershey-fonts.notes`):

  > The Hershey font glyph data is covered by a permissive use and redistribution license. This is free software: you
  > are free to change and redistribute it. There is NO WARRANTY, to the extent permitted by law.

  and its use restriction, which this copy keeps:

  > This distribution of the Hershey Fonts may be used by anyone for any purpose, commercial or otherwise, providing
  > that:
  > 1. The following acknowledgements must be distributed with the font data:
  >    - The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of
  >      Standards.
  >    - The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900
  >      Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt)
  > 2. The font data in this distribution may be converted into any other format *EXCEPT* the format distributed by
  >    the U.S. NTIS (which organization holds the rights to the distribution and use of the font data in that
  >    particular format).

The `.jhf` files are the public-domain Hershey data in Hurt's plain-text format, not the GPLv2+ `libhersheyfont` code;
the spike reads the text and writes its own table, which the licence allows (any format but NTIS's).

## Two things about the data itself

- **The glyph number column of `futural.jhf` is the placeholder `12345` on every line.** A glyph is therefore identified
  by its position: 96 lines, space (32) to delete (127). `cyrilc_1.jhf` is the other way round — real Hershey numbers
  (2199…), in no alphabetical order — and it ships no mapping from those numbers to Unicode, so the spike measures Latin
  only and counts the Cyrillic table's bytes.
- The vertex count in columns 5..8 is one more than the line's coordinate pairs; `spike/hershey/parse.mjs` counts the
  pairs from the line's length instead.
