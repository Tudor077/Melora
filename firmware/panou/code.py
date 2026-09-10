# PANOU — RP2040 sim/flight control panel
# BRING-UP / TEST FIRMWARE (phase 1).  CircuitPython.
#
# What this does:
#   * inits the 0.91" 128x32 SSD1306 OLED over I2C and shows "PANOU OK" + a counter
#   * reads every input and prints one line per change to USB serial
#     (ENC=+1 POS=7 / ENC_SW=1 / SW2=3 / SW3=5)
#   * shows live encoder count + last event on the OLED
#
# Phase 2 (USB HID gamepad) is scaffolded in panou_hid.py + boot.py and is OFF
# by default.  Nothing here touches HID.
#
# ---------------------------------------------------------------------------
# PIN MAP — edit these numbers if a pin turns out wrong on the board.
# All switches/buttons are active-LOW and use the RP2040 internal pull-ups.
#
#   Signal   GPIO   Notes
#   ------   ----   -----
#   SDA      4      OLED I2C data   (I2C0)
#   SCL      5      OLED I2C clock  (I2C0)
#   SW2_1    6      slide switch 2, position 1
#   SW2_2    7
#   SW2_3    8
#   SW2_4    9
#   SW3_1    10     slide switch 3, position 1
#   SW3_2    11
#   SW3_3    12
#   SW3_4    13
#   SW3_5    14
#   SW3_6    15
#   ENC_A    21     encoder channel A   (must be adjacent to ENC_B for rotaryio)
#   ENC_B    22     encoder channel B
#   ENC_SW   24     encoder push button
#
# The J3 D-pad / joystick module (UP/DWN/LFT/RHT/MID/SET/RST, GPIO25-28 + 3 TBD)
# is deliberately NOT read by this firmware — dropped on request.  To bring it
# back, add its pins to DPAD_PINS-style Debounced() objects the same way ENC_SW
# is wired up below.
#
# NOTE on GPIO24: on a stock Raspberry Pi Pico, GP23/24/25 are SMPS-mode,
# VBUS-sense and the onboard LED, and are not broken out.  The YD-RP2040 routes
# these differently.  If ENC_SW reads stuck at one level, check GP24 is really
# free on the board before suspecting the switch.
# ---------------------------------------------------------------------------

import time

import board
import busio
import digitalio
import microcontroller

# ----------------------------- configuration -----------------------------

PIN_SDA = 4
PIN_SCL = 5

SW2_PINS = (6, 7, 8, 9)              # 4-position slide switch
SW3_PINS = (10, 11, 12, 13, 14, 15)  # 6-position slide switch

PIN_ENC_A = 21
PIN_ENC_B = 22
PIN_ENC_SW = 24

# Quarter-steps per detent.  A typical EC11 gives 4 — set to 2 or 1 if one
# physical click reports more than one ENC= line.
ENC_DIVISOR = 4
# Positive counts mean ENC_A leads ENC_B.  Whether that is physically clockwise
# depends on how the encoder is wired, so just flip this if it reads backwards.
# Both encoder backends below use the same convention, so this flag behaves
# identically either way.
ENC_INVERT = False

BTN_DEBOUNCE_S = 0.015   # mechanical push switch
SW_SETTLE_S = 0.020      # slide switches: ride out make-before-break overlap

POLL_S = 0.002           # input poll period
DISPLAY_HZ = 10          # OLED refresh rate
HEARTBEAT_S = 5.0        # periodic STATUS line on serial; 0 disables

OLED_WIDTH = 128
OLED_HEIGHT = 32
OLED_ADDRS = (0x3C, 0x3D)   # tried in order

# ------------------------------ pin plumbing ------------------------------


def gp(number):
    """board.GPn for an RP2040 GPIO number, whatever the board definition calls it."""
    pin = getattr(board, "GP{}".format(number), None)
    if pin is None:
        pin = getattr(microcontroller.pin, "GPIO{}".format(number), None)
    if pin is None:
        raise ValueError("GPIO{} is not available on this build".format(number))
    return pin


def pulled_up_input(number):
    io = digitalio.DigitalInOut(gp(number))
    io.direction = digitalio.Direction.INPUT
    io.pull = digitalio.Pull.UP
    return io


class Debounced:
    """Active-low button.  `value` is True while pressed."""

    def __init__(self, name, number, debounce_s=BTN_DEBOUNCE_S):
        self.name = name
        self.number = number
        self._io = pulled_up_input(number)
        self._debounce = debounce_s
        self._raw = not self._io.value
        self.value = self._raw
        self._raw_at = time.monotonic()
        self.pressed = False    # edge: went down this update
        self.released = False   # edge: came up this update

    def update(self):
        self.pressed = False
        self.released = False
        raw = not self._io.value          # active low -> True means pressed
        now = time.monotonic()
        if raw != self._raw:
            self._raw = raw
            self._raw_at = now
        elif raw != self.value and (now - self._raw_at) >= self._debounce:
            self.value = raw
            self.pressed = raw
            self.released = not raw


class Selector:
    """N-position slide switch on N active-low lines.

    `position` is 1-based; 0 means no line is pulled low (switch between
    detents, or the common line is not actually grounded).
    """

    def __init__(self, name, numbers, settle_s=SW_SETTLE_S):
        self.name = name
        self.numbers = tuple(numbers)
        self._ios = [pulled_up_input(n) for n in numbers]
        self._settle = settle_s
        self._raw = self._read()
        self.position = self._raw
        self._raw_at = time.monotonic()
        self.changed = False

    def _read(self):
        for index, io in enumerate(self._ios):
            if not io.value:
                return index + 1
        return 0

    def mask(self):
        """'.1....' — one char per line, '1' where the line is active (low)."""
        return "".join("1" if not io.value else "." for io in self._ios)

    def update(self):
        self.changed = False
        raw = self._read()
        now = time.monotonic()
        if raw != self._raw:
            self._raw = raw
            self._raw_at = now
        elif raw != self.position and (now - self._raw_at) >= self._settle:
            self.position = raw
            self.changed = True


_QUAD_STEPS = (
    0, -1, 1, 0,
    1, 0, 0, -1,
    -1, 0, 0, 1,
    0, 1, -1, 0,
)


class Encoder:
    """Quadrature encoder.

    Prefers rotaryio, which on the RP2040 runs the decode in PIO — it cannot
    miss a transition even while the display is being redrawn.  rotaryio needs
    the two channels on consecutive GPIOs (21/22 are); if that ever stops
    holding, this falls back to a full quadrature state machine polled from the
    main loop.
    """

    def __init__(self, pin_a, pin_b, divisor=ENC_DIVISOR, invert=ENC_INVERT):
        self.position = 0
        self.delta = 0
        self._divisor = max(1, divisor)
        self._sign = -1 if invert else 1
        self._hw = None
        try:
            import rotaryio

            self._hw = rotaryio.IncrementalEncoder(gp(pin_a), gp(pin_b))
            try:
                self._hw.divisor = self._divisor
            except (AttributeError, ValueError):
                pass  # older builds: fixed at 4, which is what we want anyway
            self._hw_last = self._hw.position
            self.backend = "rotaryio/PIO"
        except Exception as err:  # noqa: BLE001 - any failure falls back to software
            self._a = pulled_up_input(pin_a)
            self._b = pulled_up_input(pin_b)
            self._state = (self._a.value << 1) | self._b.value
            self._accum = 0
            self.backend = "software state machine ({})".format(err)

    def update(self):
        if self._hw is not None:
            now = self._hw.position
            self.delta = self._sign * (now - self._hw_last)
            self._hw_last = now
        else:
            state = (self._a.value << 1) | self._b.value
            self._accum += _QUAD_STEPS[(self._state << 2) | state]
            self._state = state
            self.delta = 0
            while self._accum >= self._divisor:
                self._accum -= self._divisor
                self.delta += self._sign
            while self._accum <= -self._divisor:
                self._accum += self._divisor
                self.delta -= self._sign
        self.position += self.delta
        return self.delta


# -------------------------------- display --------------------------------


class Oled:
    """SSD1306 over I2C via displayio.  Degrades to a no-op if absent."""

    def __init__(self):
        self.ok = False
        self.detail = "not initialised"
        self._labels = []
        self._shown = []
        self._cols = 21

    def init(self):
        try:
            import displayio
            import terminalio
            import adafruit_displayio_ssd1306
            from adafruit_display_text import label
        except ImportError as err:
            self.detail = "missing library: {}".format(err)
            return False

        try:
            displayio.release_displays()
            i2c = busio.I2C(gp(PIN_SCL), gp(PIN_SDA))

            while not i2c.try_lock():
                pass
            try:
                found = i2c.scan()
            finally:
                i2c.unlock()
            print("I2C scan (SDA=GP{} SCL=GP{}): {}".format(
                PIN_SDA, PIN_SCL, [hex(a) for a in found] or "nothing found"))

            addr = next((a for a in OLED_ADDRS if a in found), None)
            if addr is None:
                self.detail = "no SSD1306 at {}".format(
                    "/".join(hex(a) for a in OLED_ADDRS))
                return False

            try:
                from i2cdisplaybus import I2CDisplayBus
            except ImportError:  # CircuitPython 8
                from displayio import I2CDisplay as I2CDisplayBus

            bus = I2CDisplayBus(i2c, device_address=addr)
            display = adafruit_displayio_ssd1306.SSD1306(
                bus, width=OLED_WIDTH, height=OLED_HEIGHT)

            glyph_w, glyph_h = terminalio.FONT.get_bounding_box()[:2]
            rows = max(1, min(3, OLED_HEIGHT // glyph_h))
            self._cols = max(8, OLED_WIDTH // glyph_w)
            step = OLED_HEIGHT // rows

            group = displayio.Group()
            for row in range(rows):
                text = label.Label(
                    terminalio.FONT, text="", color=0xFFFFFF,
                    x=0, y=step * row + step // 2)
                group.append(text)
                self._labels.append(text)
            self._shown = [""] * rows

            try:
                display.root_group = group
            except AttributeError:  # CircuitPython 8
                display.show(group)

            self.ok = True
            self.detail = "SSD1306 {}x{} at {}, {} text row(s)".format(
                OLED_WIDTH, OLED_HEIGHT, hex(addr), rows)
            return True
        except Exception as err:  # noqa: BLE001 - bring-up must survive a dead OLED
            self.detail = "init failed: {}".format(err)
            return False

    def render(self, tick, enc_position, last_event):
        if not self.ok:
            return
        if len(self._labels) >= 3:
            texts = (
                "PANOU OK  t={}".format(tick),
                "ENC={:+d}".format(enc_position),
                "L={}".format(last_event),
            )
        else:
            texts = (
                "PANOU OK  t={}".format(tick),
                "E{:+d} {}".format(enc_position, last_event),
            )
        for index, text in enumerate(texts[:len(self._labels)]):
            text = text[:self._cols]
            if text != self._shown[index]:
                self._labels[index].text = text
                self._shown[index] = text


# ---------------------------------- main ----------------------------------


def banner(encoder, oled):
    print("")
    print("=" * 46)
    print("PANOU bring-up / test mode")
    print("=" * 46)
    print("OLED      SDA=GP{}  SCL=GP{}".format(PIN_SDA, PIN_SCL))
    print("SW2       GP{} (4 positions)".format(
        " GP".join(str(n) for n in SW2_PINS)))
    print("SW3       GP{} (6 positions)".format(
        " GP".join(str(n) for n in SW3_PINS)))
    print("ENC_A=GP{}  ENC_B=GP{}  ENC_SW=GP{}".format(
        PIN_ENC_A, PIN_ENC_B, PIN_ENC_SW))
    print("encoder   {}, divisor={}, invert={}".format(
        encoder.backend, ENC_DIVISOR, ENC_INVERT))
    print("display   {}".format(oled.detail))
    print("J3 D-pad / joystick: not used by this firmware")
    print("-" * 46)
    print("Move every control; each change prints one line below.")
    print("")


def main():
    oled = Oled()
    oled.init()

    encoder = Encoder(PIN_ENC_A, PIN_ENC_B)
    enc_sw = Debounced("ENC_SW", PIN_ENC_SW)
    sw2 = Selector("SW2", SW2_PINS)
    sw3 = Selector("SW3", SW3_PINS)

    banner(encoder, oled)

    # Initial state, so a switch already parked somewhere is visible at boot.
    print("SW2={} [{}]".format(sw2.position, sw2.mask()))
    print("SW3={} [{}]".format(sw3.position, sw3.mask()))
    print("ENC_SW={}".format(1 if enc_sw.value else 0))

    last_event = "-"
    tick = 0
    now = time.monotonic()
    next_display = now
    next_tick = now + 1.0
    next_heartbeat = now + HEARTBEAT_S if HEARTBEAT_S else None

    while True:
        delta = encoder.update()
        enc_sw.update()
        sw2.update()
        sw3.update()

        if delta:
            print("ENC={:+d} POS={}".format(delta, encoder.position))
            last_event = "ENC{:+d}".format(delta)
        if enc_sw.pressed or enc_sw.released:
            state = 1 if enc_sw.value else 0
            print("ENC_SW={}".format(state))
            if enc_sw.pressed:
                last_event = "ENC_SW"
        if sw2.changed:
            print("SW2={} [{}]".format(sw2.position, sw2.mask()))
            last_event = "SW2:{}".format(sw2.position)
        if sw3.changed:
            print("SW3={} [{}]".format(sw3.position, sw3.mask()))
            last_event = "SW3:{}".format(sw3.position)

        now = time.monotonic()
        if now >= next_tick:
            next_tick += 1.0
            tick += 1
        if now >= next_display:
            next_display = now + 1.0 / DISPLAY_HZ
            oled.render(tick, encoder.position, last_event)
        if next_heartbeat is not None and now >= next_heartbeat:
            next_heartbeat = now + HEARTBEAT_S
            print("STATUS t={} ENC={} ENC_SW={} SW2={} SW3={}".format(
                tick, encoder.position, 1 if enc_sw.value else 0,
                sw2.position, sw3.position))

        time.sleep(POLL_S)


main()
