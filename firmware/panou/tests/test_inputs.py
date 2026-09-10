"""Host-side simulation of code.py's input logic. Stubs board/digitalio/etc."""
import os, sys, types, time

PINS = {}  # gpio number -> bool level (True = high = idle for pull-up inputs)

class FakePin:
    def __init__(self, n): self.n = n

board = types.ModuleType("board")
for n in range(30): setattr(board, "GP%d" % n, FakePin(n))
mc = types.ModuleType("microcontroller"); mc.pin = types.SimpleNamespace()
busio = types.ModuleType("busio"); busio.I2C = lambda *a, **k: None

digitalio = types.ModuleType("digitalio")
class _DIO:
    def __init__(self, pin): self.pin = pin; self.direction = None; self.pull = None
    @property
    def value(self): return PINS.get(self.pin.n, True)
digitalio.DigitalInOut = _DIO
digitalio.Direction = types.SimpleNamespace(INPUT="in")
digitalio.Pull = types.SimpleNamespace(UP="up")

for mod in (board, mc, busio, digitalio): sys.modules[mod.__name__] = mod
# force the software encoder fallback so we exercise the state machine
sys.modules["rotaryio"] = None

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "code.py")).read().replace("\nmain()\n", "\n")
ns = {"__name__": "panou_code"}
exec(compile(src, "code.py", "exec"), ns)

FAKE_NOW = [0.0]
ns["time"].monotonic = lambda: FAKE_NOW[0]
def advance(s): FAKE_NOW[0] += s

fails = []
def check(label, got, want):
    ok = got == want
    print("%-44s %-10s %s" % (label, "ok" if ok else "FAIL", "" if ok else "got %r want %r" % (got, want)))
    if not ok: fails.append(label)

# ---- Selector: 6-position slide switch -------------------------------------
PINS.clear()
sw3 = ns["Selector"]("SW3", (10, 11, 12, 13, 14, 15))
check("SW3 floating -> position 0", sw3.position, 0)
PINS[14] = False                       # SW3_5 grounded
sw3.update(); check("SW3 pos5 not latched before settle", sw3.position, 0)
advance(0.030); sw3.update()
check("SW3 pos5 after settle", (sw3.position, sw3.changed), (5, True))
check("SW3 mask", sw3.mask(), "....1.")
sw3.update(); check("SW3 no repeat change", sw3.changed, False)
# make-before-break: two lines briefly low must not emit a bogus position
PINS[13] = False
advance(0.005); sw3.update()
check("SW3 overlap ignored mid-throw", (sw3.position, sw3.changed), (5, False))
del PINS[14]
advance(0.030); sw3.update()
check("SW3 settles on pos4", (sw3.position, sw3.changed), (4, True))

# ---- Debounced push switch --------------------------------------------------
PINS.clear(); advance(1.0)
btn = ns["Debounced"]("ENC_SW", 24)
check("ENC_SW idle released", btn.value, False)
PINS[24] = False                       # pressed
btn.update(); check("press not latched before debounce", btn.value, False)
advance(0.020); btn.update()
check("press latched after debounce", (btn.value, btn.pressed), (True, True))
btn.update(); check("press edge is one-shot", btn.pressed, False)
# contact bounce: blip high for 5 ms must not register a release
PINS[24] = True; advance(0.005); btn.update()
PINS[24] = False; advance(0.005); btn.update()
check("bounce did not release", (btn.value, btn.released), (True, False))
PINS[24] = True; btn.update()          # poll that sees the release
advance(0.020); btn.update()           # poll that latches it
check("real release latched", (btn.value, btn.released), (False, True))

# ---- Encoder software state machine ----------------------------------------
PINS.clear()
enc = ns["Encoder"](21, 22, divisor=4, invert=False)
assert "software" in enc.backend, enc.backend
def quad(seq):
    """Drive A/B through a gray-code sequence, returning total detents."""
    total = 0
    for a, b in seq:
        PINS[21] = bool(a); PINS[22] = bool(b)
        total += enc.update()
    return total
# Positive = A leads B, which is what rotaryio/PIO also calls positive.
# Whether that is physically clockwise depends on the wiring -> ENC_INVERT.
CW  = [(0,1),(0,0),(1,0),(1,1)]   # one full detent, A leading, from idle (1,1)
CCW = [(1,0),(0,0),(0,1),(1,1)]
check("one detent CW -> +1", quad(CW), 1)
check("encoder position after 1 CW", enc.position, 1)
check("three detents CW -> +3", quad(CW*3), 3)
check("position after 4 CW", enc.position, 4)
check("one detent CCW -> -1", quad(CCW), -1)
check("five detents CCW -> -5", quad(CCW*5), -5)
check("position back to -2", enc.position, -2)
# half a detent then back must net zero (no phantom counts from jitter)
before = enc.position
quad([(1,0),(0,0),(1,0),(1,1)])
check("jitter within one detent nets zero", enc.position, before)
# inverted wiring
PINS.clear()
enc_i = ns["Encoder"](21, 22, divisor=4, invert=True)
def quad_i(seq):
    t = 0
    for a, b in seq:
        PINS[21] = bool(a); PINS[22] = bool(b); t += enc_i.update()
    return t
check("inverted: CW reports -1", quad_i(CW), -1)
# divisor 1 (encoder with no detents / 1 count per step)
PINS.clear()
enc_d1 = ns["Encoder"](21, 22, divisor=1, invert=False)
def quad_d(seq):
    t = 0
    for a, b in seq:
        PINS[21] = bool(a); PINS[22] = bool(b); t += enc_d1.update()
    return t
check("divisor=1: one detent -> 4 counts", quad_d(CW), 4)

# ---- Selector on the 4-position switch, every position ---------------------
PINS.clear(); advance(1.0)
sw2 = ns["Selector"]("SW2", (6, 7, 8, 9))
for pos, pin in enumerate((6, 7, 8, 9), start=1):
    PINS.clear(); PINS[pin] = False
    sw2.update()                       # poll that sees the new line
    advance(0.030); sw2.update()       # poll that latches it
    check("SW2 pin GP%d -> position %d" % (pin, pos), sw2.position, pos)

# ---- Oled degrades gracefully when the library/panel is missing ------------
oled = ns["Oled"]()
check("Oled.init() returns False w/o libs", oled.init(), False)
oled.render(1, 2, "x")  # must not raise
check("Oled.render() no-op when absent", oled.ok, False)

print()
print("FAILED: %d" % len(fails) if fails else "all checks passed")
sys.exit(1 if fails else 0)
