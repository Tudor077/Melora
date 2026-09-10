# PANOU — USB HID gamepad layer (phase 2 scaffold).
#
# This module is NOT imported by the bring-up firmware.  Nothing here runs
# until you enable it, so it cannot interfere with phase 1 testing.
#
# To turn it on:
#   1. create an empty file called  hid_enabled  in the root of CIRCUITPY
#   2. power-cycle the board (boot.py only runs on a hard reset, not on save)
#   3. set ENABLE_HID = True in code.py's phase-2 block, or write your own
#      loop around Gamepad below
#
# Report layout (report ID 4, 4 bytes):
#   byte 0-1  16 buttons, little-endian bitfield, button 1 = bit 0
#   byte 2    X axis, signed -127..127
#   byte 3    Y axis, signed -127..127

GAMEPAD_REPORT_DESCRIPTOR = bytes((
    0x05, 0x01,        # Usage Page (Generic Desktop)
    0x09, 0x05,        # Usage (Gamepad)
    0xA1, 0x01,        # Collection (Application)
    0x85, 0x04,        #   Report ID (4)
    0x05, 0x09,        #   Usage Page (Button)
    0x19, 0x01,        #   Usage Minimum (Button 1)
    0x29, 0x10,        #   Usage Maximum (Button 16)
    0x15, 0x00,        #   Logical Minimum (0)
    0x25, 0x01,        #   Logical Maximum (1)
    0x75, 0x01,        #   Report Size (1)
    0x95, 0x10,        #   Report Count (16)
    0x81, 0x02,        #   Input (Data, Variable, Absolute)
    0x05, 0x01,        #   Usage Page (Generic Desktop)
    0x15, 0x81,        #   Logical Minimum (-127)
    0x25, 0x7F,        #   Logical Maximum (127)
    0x09, 0x30,        #   Usage (X)
    0x09, 0x31,        #   Usage (Y)
    0x75, 0x08,        #   Report Size (8)
    0x95, 0x02,        #   Report Count (2)
    0x81, 0x02,        #   Input (Data, Variable, Absolute)
    0xC0,              # End Collection
))

REPORT_ID = 4
REPORT_LENGTH = 4
NUM_BUTTONS = 16

# Proposed button map — 13 of 16 used, 3 spare.
BTN_ENC_CW = 1          # pulsed once per detent clockwise
BTN_ENC_CCW = 2         # pulsed once per detent counter-clockwise
BTN_ENC_SW = 3          # encoder push switch, follows the physical button
BTN_SW2_BASE = 4        # SW2 position n -> button BTN_SW2_BASE + (n - 1), 4..7
BTN_SW3_BASE = 8        # SW3 position n -> button BTN_SW3_BASE + (n - 1), 8..13

ENC_PULSE_S = 0.030     # how long an encoder detent holds its button down


def make_device():
    """The usb_hid.Device for this gamepad.  Call from boot.py only."""
    import usb_hid

    return usb_hid.Device(
        report_descriptor=GAMEPAD_REPORT_DESCRIPTOR,
        usage_page=0x01,
        usage=0x05,
        report_ids=(REPORT_ID,),
        in_report_lengths=(REPORT_LENGTH,),
        out_report_lengths=(0,),
    )


def find_device():
    """The enabled gamepad device, or None if boot.py did not enable it."""
    import usb_hid

    for device in usb_hid.devices:
        if device.usage_page == 0x01 and device.usage == 0x05:
            return device
    return None


class Gamepad:
    """Buttons + two axes, sent only when something actually changed."""

    def __init__(self, device=None):
        self._device = device if device is not None else find_device()
        if self._device is None:
            raise RuntimeError(
                "gamepad HID device not enabled - create /hid_enabled on "
                "CIRCUITPY and hard-reset the board")
        self._report = bytearray(REPORT_LENGTH)
        self._sent = bytearray(REPORT_LENGTH)
        self._sent[0] = 0xFF  # force the first send

    def set_button(self, number, pressed):
        if not 1 <= number <= NUM_BUTTONS:
            raise ValueError("button must be 1..{}".format(NUM_BUTTONS))
        index, bit = divmod(number - 1, 8)
        if pressed:
            self._report[index] |= 1 << bit
        else:
            self._report[index] &= ~(1 << bit) & 0xFF

    def release_all(self):
        self._report[0] = 0
        self._report[1] = 0

    def set_axes(self, x=None, y=None):
        if x is not None:
            self._report[2] = min(127, max(-127, int(x))) & 0xFF
        if y is not None:
            self._report[3] = min(127, max(-127, int(y))) & 0xFF

    def set_selector(self, base, position, count):
        """One-hot a slide switch: position 1..count, 0 clears them all."""
        for offset in range(count):
            self.set_button(base + offset, position == offset + 1)

    def send(self, force=False):
        if not force and self._report == self._sent:
            return False
        self._device.send_report(self._report, REPORT_ID)
        self._sent[:] = self._report
        return True
