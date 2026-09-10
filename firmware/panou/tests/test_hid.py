import os, sys, types
sent = []
class FakeDev:
    usage_page = 0x01; usage = 0x05
    def send_report(self, report, rid): sent.append((bytes(report), rid))
usb_hid = types.ModuleType("usb_hid"); usb_hid.devices = (FakeDev(),)
usb_hid.Device = lambda **kw: FakeDev()
sys.modules["usb_hid"] = usb_hid
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
import panou_hid as H

fails = []
def check(label, got, want):
    ok = got == want
    print("%-46s %-6s %s" % (label, "ok" if ok else "FAIL", "" if ok else "got %r want %r" % (got, want)))
    if not ok: fails.append(label)

# descriptor sanity: walk it as real HID short items
def walk(desc):
    """Return (items, depth_ok, consumed_exactly) by decoding short items."""
    i = 0; depth = 0; items = []; balanced = True
    while i < len(desc):
        prefix = desc[i]
        size = {0: 0, 1: 1, 2: 2, 3: 4}[prefix & 0x03]
        tag, typ = prefix >> 4, (prefix >> 2) & 0x03
        data = int.from_bytes(desc[i + 1:i + 1 + size], "little") if size else None
        if i + 1 + size > len(desc):
            return items, False, False
        items.append((typ, tag, data))
        if typ == 0 and tag == 0xA: depth += 1           # Collection
        if typ == 0 and tag == 0xC:                      # End Collection
            depth -= 1
            if depth < 0: balanced = False
        i += 1 + size
    return items, balanced and depth == 0, i == len(desc)

items, balanced, consumed = walk(H.GAMEPAD_REPORT_DESCRIPTOR)
check("descriptor decodes cleanly to the last byte", consumed, True)
check("descriptor collections balance", balanced, True)
inputs = [it for it in items if it[0] == 0 and it[1] == 0x8]
check("descriptor has 2 Input items", len(inputs), 2)
rid = [it[2] for it in items if it[0] == 1 and it[1] == 0x8]
check("descriptor report ID matches REPORT_ID", rid, [H.REPORT_ID])
check("descriptor is a Collection", (H.GAMEPAD_REPORT_DESCRIPTOR[4], H.GAMEPAD_REPORT_DESCRIPTOR[-1]), (0xA1, 0xC0))
bits = 16 * 1 + 2 * 8        # 16 one-bit buttons + two 8-bit axes
check("descriptor bits match REPORT_LENGTH", bits // 8, H.REPORT_LENGTH)
check("find_device finds the gamepad", H.find_device() is not None, True)

pad = H.Gamepad()
pad.set_button(1, True); pad.send()
check("button 1 -> byte0 bit0", sent[-1][0], b"\x01\x00\x00\x00")
check("report id", sent[-1][1], 4)
pad.set_button(9, True); pad.send()
check("button 9 -> byte1 bit0", sent[-1][0], b"\x01\x01\x00\x00")
pad.set_button(16, True); pad.send()
check("button 16 -> byte1 bit7", sent[-1][0], b"\x01\x81\x00\x00")
pad.set_button(1, False); pad.send()
check("release clears only that bit", sent[-1][0], b"\x00\x81\x00\x00")
n = len(sent)
check("unchanged report is not resent", pad.send(), False)
check("no extra traffic", len(sent), n)
check("force resends", pad.send(force=True), True)
pad.release_all(); pad.send()
check("release_all clears both bytes", sent[-1][0], b"\x00\x00\x00\x00")

pad.set_axes(x=127, y=-127); pad.send()
check("axes extremes", sent[-1][0], b"\x00\x00\x7f\x81")
pad.set_axes(x=900, y=-900); pad.send()
check("axes clamped to +-127", sent[-1][0], b"\x00\x00\x7f\x81")
pad.set_axes(x=0, y=0); pad.send()
check("axes centred", sent[-1][0], b"\x00\x00\x00\x00")

# slide switches one-hot onto the proposed button map
pad.set_selector(H.BTN_SW2_BASE, 3, 4); pad.send()
check("SW2 pos3 -> button 6 only", sent[-1][0], b"\x20\x00\x00\x00")
pad.set_selector(H.BTN_SW2_BASE, 1, 4); pad.send()
check("SW2 pos1 -> button 4 only", sent[-1][0], b"\x08\x00\x00\x00")
pad.set_selector(H.BTN_SW2_BASE, 0, 4); pad.send()
check("SW2 pos0 clears all SW2 buttons", sent[-1][0], b"\x00\x00\x00\x00")
pad.set_selector(H.BTN_SW3_BASE, 6, 6); pad.send()
check("SW3 pos6 -> button 13", sent[-1][0], b"\x00\x10\x00\x00")
# the full map must fit in 16 buttons without overlapping
used = ([H.BTN_ENC_CW, H.BTN_ENC_CCW, H.BTN_ENC_SW]
        + [H.BTN_SW2_BASE + i for i in range(4)]
        + [H.BTN_SW3_BASE + i for i in range(6)])
check("button map has no collisions", len(set(used)), len(used))
check("button map fits in 16", max(used) <= H.NUM_BUTTONS, True)
try:
    pad.set_button(17, True); check("button 17 rejected", "no error", "ValueError")
except ValueError:
    check("button 17 rejected", "ValueError", "ValueError")

print()
print("FAILED: %d" % len(fails) if fails else "all checks passed")
sys.exit(1 if fails else 0)
