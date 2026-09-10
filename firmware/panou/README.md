# PANOU — RP2040 sim/flight control panel firmware

CircuitPython firmware for a YD-RP2040-based USB control panel.

**Phase 1 (this code, ready to flash):** bring-up / test mode — OLED says
`PANOU OK` with a live counter, and every input prints one line per change to
USB serial so you can confirm the board before trusting it.

**Phase 2 (scaffolded, disabled):** USB HID gamepad. See
[Phase 2](#phase-2--usb-hid-gamepad) below.

The J3 D-pad / joystick module is **not** read by this firmware — dropped on
request. Nothing is wired to GPIO25–28, and the three unconfirmed MID/SET/RST
pins are not referenced anywhere, so there is nothing left to confirm before
flashing.

---

## Pin map

All switches and buttons are active-LOW on the RP2040's internal pull-ups — no
external resistors. Edit the constants at the top of `code.py` if a pin is
wrong; they are the single source of truth and the boot banner prints them back
to you.

| Signal | GPIO | Notes |
|--------|------|-------|
| SDA    | 4  | OLED I2C data (I2C0) |
| SCL    | 5  | OLED I2C clock (I2C0) |
| SW2_1…SW2_4 | 6, 7, 8, 9 | 4-position slide switch |
| SW3_1…SW3_6 | 10, 11, 12, 13, 14, 15 | 6-position slide switch |
| ENC_A  | 21 | encoder channel A |
| ENC_B  | 22 | encoder channel B |
| ENC_SW | 24 | encoder push button |

Two things worth checking against the board before you blame the firmware:

- **GPIO24.** On a stock Raspberry Pi Pico, GP23/24/25 are SMPS mode, VBUS
  sense and the onboard LED, and are not broken out to the header. The
  YD-RP2040 routes them differently. If `ENC_SW` reads stuck at one level,
  confirm GP24 is actually free on the board.
- **ENC_A / ENC_B must stay adjacent.** `rotaryio` decodes the encoder in PIO
  on the RP2040 and needs the two channels on consecutive GPIOs. 21/22
  qualifies. If a respin moves them apart, the code falls back to a software
  state machine automatically and says so in the boot banner — but the PIO path
  is the one that cannot miss a detent while the display is redrawing.

---

## Install

### 1. CircuitPython

Download the UF2 from [circuitpython.org/downloads](https://circuitpython.org/downloads):

- prefer the **VCC-GND Studio YD-RP2040** build — it knows about the board's
  full 4 MB (or 16 MB) flash, so you get a much larger `CIRCUITPY` drive
- the generic **Raspberry Pi Pico** build also runs fine, but assumes 2 MB and
  leaves you ~1 MB of storage

Hold BOOT, tap RESET, drop the `.uf2` on the `RPI-RP2` drive. The board
reappears as `CIRCUITPY`. CircuitPython 9.x or 10.x; the code also handles 8.x
API names.

### 2. Libraries

Download the bundle matching your CircuitPython **major** version from
[circuitpython.org/libraries](https://circuitpython.org/libraries)
(*Adafruit CircuitPython Bundle*), then copy exactly these into `CIRCUITPY/lib/`:

| Copy this | From the bundle's `lib/` | What for |
|-----------|--------------------------|----------|
| `adafruit_displayio_ssd1306.mpy` | file | the SSD1306 display driver |
| `adafruit_display_text/` | whole folder | `label.Label` text rendering |

That is the complete list — two entries. Everything else this firmware uses
(`displayio`, `terminalio`, `i2cdisplaybus`, `busio`, `digitalio`, `rotaryio`,
`usb_hid`) is built into the CircuitPython binary.

### 3. This firmware

Copy to the root of `CIRCUITPY`:

```
CIRCUITPY/
├── code.py          <- bring-up firmware, runs on every save
├── boot.py          <- disables HID during bring-up; runs on hard reset only
├── panou_hid.py     <- phase 2 gamepad scaffold, unused until enabled
└── lib/
    ├── adafruit_displayio_ssd1306.mpy
    └── adafruit_display_text/
```

`boot.py` is optional but recommended for bring-up: it turns USB HID off so the
panel cannot emit phantom keystrokes while you are testing. USB serial is
unaffected either way. **`boot.py` only runs on a hard reset** — power-cycle or
tap RESET after copying it; saving a file is not enough.

---

## Running the bring-up test

Open the serial console — `screen /dev/ttyACM0 115200` or `picocom` on Linux,
the Mu editor's Serial panel, or PuTTY on the matching COM port on Windows.
Tap RESET and you should see:

```
==============================================
PANOU bring-up / test mode
==============================================
I2C scan (SDA=GP4 SCL=GP5): ['0x3c']
OLED      SDA=GP4  SCL=GP5
SW2       GP6 GP7 GP8 GP9 (4 positions)
SW3       GP10 GP11 GP12 GP13 GP14 GP15 (6 positions)
ENC_A=GP21  ENC_B=GP22  ENC_SW=GP24
encoder   rotaryio/PIO, divisor=4, invert=False
display   SSD1306 128x32 at 0x3c, 2 text row(s)
J3 D-pad / joystick: not used by this firmware
----------------------------------------------
Move every control; each change prints one line below.

SW2=3 [..1.]
SW3=5 [....1.]
ENC_SW=0
```

The two `SW` lines are the switches' *current* parked position, printed once at
boot so a switch that never moves is still visible. Then every change prints a
line:

```
ENC=+1 POS=1
ENC=+1 POS=2
ENC=-1 POS=1
ENC_SW=1
ENC_SW=0
SW2=4 [...1]
SW3=2 [.1....]
STATUS t=5 ENC=1 ENC_SW=0 SW2=4 SW3=2
```

The bracketed mask shows one character per switch line, `1` where that line is
pulled low — so a miswired or bridged position is obvious rather than just
giving a wrong number. `STATUS` is a 5-second heartbeat proving the loop is
alive (set `HEARTBEAT_S = 0` to silence it).

The OLED shows `PANOU OK  t=<seconds>` on the top row and the live encoder
count plus the last event below it.

### Checklist

- [ ] OLED lights up, counter increments once a second
- [ ] encoder: one click = exactly one `ENC=+1` or `ENC=-1`, no skips, no doubles
- [ ] encoder direction: clockwise gives `+1` (if not, set `ENC_INVERT = True`)
- [ ] `ENC_SW=1` on press, `ENC_SW=0` on release, no chatter
- [ ] SW2 walks cleanly through 1, 2, 3, 4
- [ ] SW3 walks cleanly through 1 … 6

### Troubleshooting

| Symptom | Cause |
|---------|-------|
| `I2C scan: nothing found` | SDA/SCL swapped or not connected, or the OLED has no power. The firmware keeps running serial-only so you can still test the inputs. |
| Scan finds `0x3c` but display stays blank | missing `lib/` files — the banner's `display` line names the missing library |
| `missing library: ...` | bundle not copied, or a bundle built for a different CircuitPython major version |
| one click = 2 or 4 `ENC` lines | set `ENC_DIVISOR` to 2 or 1 |
| clockwise counts down | set `ENC_INVERT = True` |
| `SW2=0` in every position | the switch common is not actually grounded — the mask will show all dots |
| two bits set in the mask | positions bridged, or a make-before-break switch needing a longer `SW_SETTLE_S` |
| `ENC_SW` stuck at one value | check GP24 is free on the YD-RP2040 (see the pin map notes) |
| `encoder software state machine (...)` in the banner | `rotaryio` refused the pins; the message says why. Still works, just polled. |

Tuning knobs, all at the top of `code.py`: `BTN_DEBOUNCE_S`, `SW_SETTLE_S`,
`POLL_S`, `DISPLAY_HZ`, `HEARTBEAT_S`.

---

## Phase 2 — USB HID gamepad

`panou_hid.py` holds the HID report descriptor and a `Gamepad` helper. It is
imported by nothing, so it cannot affect phase 1.

Report ID 4, 4 bytes: 16 buttons as a little-endian bitfield, then signed X and
Y axes. Proposed map, 13 of 16 buttons used:

| Control | Buttons |
|---------|---------|
| encoder clockwise | 1, pulsed per detent |
| encoder counter-clockwise | 2, pulsed per detent |
| encoder push | 3, follows the physical switch |
| SW2 positions 1–4 | 4–7, one-hot |
| SW3 positions 1–6 | 8–13, one-hot |

To enable: create an empty file named `hid_enabled` in the root of `CIRCUITPY`,
power-cycle, then drive `Gamepad` from your loop. Reusing phase 1's objects:

```python
import panou_hid
pad = panou_hid.Gamepad()
pad.set_button(panou_hid.BTN_ENC_SW, enc_sw.value)
pad.set_selector(panou_hid.BTN_SW2_BASE, sw2.position, 4)
pad.set_selector(panou_hid.BTN_SW3_BASE, sw3.position, 6)
pad.send()                      # no-ops unless something actually changed
```

Encoder detents need a pulse, not a level — hold `BTN_ENC_CW` for
`ENC_PULSE_S` (~30 ms) so the sim sees a discrete press, then release it.
Alternatively feed `encoder.position` into `set_axes()` to get a continuous
axis instead; the descriptor already carries X and Y for that.

### Why CircuitPython, and when not to

Sticking with CircuitPython, as you preferred — for this panel it is the right
call and I would not switch:

- ~15 inputs polled at 2 ms is nowhere near the limit; the PIO encoder decode
  means timing-critical work is not in Python at all
- a custom gamepad descriptor is fully supported via `usb_hid.enable()` in
  `boot.py`, which is what `panou_hid.py` does — no library gap to work around
- drag-and-drop `lib/`, live `code.py` editing, and serial `print()` debugging
  are exactly what bring-up wants

Reasons you might still move later, so you can judge for yourself:

- **Arduino-C / TinyUSB** wins if you need sub-millisecond report latency, more
  than one HID interface (gamepad *and* keyboard *and* a composite device), a
  custom USB product name and VID/PID, or force feedback. `boot.py` can rename
  the device, but fine-grained USB control is easier in C.
- **MicroPython** has no real advantage here — HID support is weaker than
  CircuitPython's, so there is no reason to switch for this build.

If you later want a polished gamepad with a custom USB identity, Arduino-C is
the move. Nothing in phase 1 is wasted either way: the pin map and the switch
decode logic port over directly.

---

## Tests

`tests/` holds host-side simulations — they stub `board`/`digitalio`/`rotaryio`
and exercise the debounce, slide-switch decode, quadrature state machine and
HID report packing without hardware. They do **not** run on the board.

```sh
python3 firmware/panou/tests/test_inputs.py
python3 firmware/panou/tests/test_hid.py
```

Plain `python3`, no dependencies. Worth re-running if you change a timing
constant or the button map.
