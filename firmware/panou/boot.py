# PANOU — USB device setup.  Runs once on hard reset (power-cycle or RESET),
# NOT when you just save code.py.
#
# Default: HID is disabled entirely, so the panel shows up as a plain
# CIRCUITPY drive + USB serial and cannot type phantom keystrokes while you are
# testing.  USB serial (CDC) is untouched either way, so bring-up printing keeps
# working.
#
# To enable the gamepad: create an empty file named  hid_enabled  in the root of
# CIRCUITPY, then power-cycle the board.

import os

import usb_hid

try:
    enabled = "hid_enabled" in os.listdir("/")
except OSError:
    enabled = False

if enabled:
    try:
        import panou_hid

        usb_hid.enable((panou_hid.make_device(),))
        print("boot.py: PANOU gamepad HID enabled")
    except Exception as err:  # noqa: BLE001 - never brick USB over a typo
        usb_hid.disable()
        print("boot.py: gamepad HID failed, disabled instead: {}".format(err))
else:
    usb_hid.disable()
    print("boot.py: HID disabled (bring-up mode)")
