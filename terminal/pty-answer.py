#!/usr/bin/env python3
# A pty that answers the terminal's colour query: `terminal/solid.ts` writes QUERY (OSC 11, 10, 4 and CSI ? 996 n) to
# /dev/tty and reads the reply, so the check needs a terminal whose other end is a script. This is that end: a child on a
# pty of its own (pty.fork makes it the controlling terminal, so /dev/tty is this slave), its bytes forwarded to stdout,
# and the reply -- the bytes of a file, or none -- written when the query's OSC 11 goes past. `PTY_WALK_SECONDS` bounds the
# child: a host that waits with no timeout (`--mutate wait`) is killed and says so, which is that mutation's evidence.
#
#   python3 terminal/pty-answer.py <reply-file|-> <seconds> -- <command...>
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time

reply_path, walk, sep, *command = sys.argv[1:]
assert sep == "--" and command, "usage: pty-answer.py <reply-file|-> <seconds> -- <command...>"
reply = b"" if reply_path == "-" else open(reply_path, "rb").read()
limit = float(walk)

pid, fd = pty.fork()
if pid == 0:
    os.execvp(command[0], command)
# the pty's window: termbox2 asks it for the grid (0x0 draws nothing, as xterm would)
cols, rows = int(os.environ.get("PTY_COLS", "80")), int(os.environ.get("PTY_ROWS", "24"))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

seen = b""
sent = False
out = bytearray()
deadline = time.monotonic() + limit
status = None
while time.monotonic() < deadline:
    got, st = os.waitpid(pid, os.WNOHANG)
    if got == pid:
        status = st
        break
    r, _, _ = select.select([fd], [], [], 0.05)
    if r:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            chunk = b""
        if not chunk:
            break
        out += chunk
        seen += chunk
        if reply and not sent and b"\x1b]11;?" in seen:
            os.write(fd, reply)
            sent = True
# the last of the child's output, after it exited (its stdout is the pty; EIO is the end)
for _ in range(200):
    r, _, _ = select.select([fd], [], [], 0.02)
    if not r:
        break
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        break
    if not chunk:
        break
    out += chunk
sys.stdout.buffer.write(bytes(out))
sys.stdout.buffer.flush()
if status is None:
    got, st = os.waitpid(pid, os.WNOHANG)
    if got == pid:
        status = st
if status is None:
    sys.stderr.write(f"pty-answer: the host was still running after {limit:g}s; killed\n")
    os.kill(pid, 9)
    _, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
