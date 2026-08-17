import sys
import json
import hashlib
import screen_brightness_control as sbc


def _monitors():
    """Current monitors, richest form. Enumeration ORDER IS NOT STABLE."""
    try:
        return sbc.list_monitors_info()
    except Exception:
        return []


def stable_id(m):
    """A key identifying the PHYSICAL panel, independent of enumeration order.

    The enumeration index cannot serve as an identity. Making a different monitor the
    Windows primary display renumbers them, so a snapshot taken as {0: LG, 1: HP} is
    replayed later as {0: HP, 1: LG} and each panel is handed the OTHER one's
    brightness. That is silent whenever the two values happen to match and wrong the
    moment they don't.

    EDID is the panel's own descriptor and survives renumbering, replugging and
    reboots; it is hashed only to keep the key short enough to pass as an argument.
    Serial cannot be the primary key -- plenty of panels report none at all (the LG
    QHD on this machine reports null), so it is only a fallback.
    """
    edid = m.get('edid')
    if edid:
        return 'edid:' + hashlib.sha256(edid.encode()).hexdigest()[:16]
    serial = m.get('serial')
    if serial:
        return 'serial:' + str(serial)
    return 'name:' + str(m.get('name'))


def _resolve(identifier):
    """Map any identifier Halo has ever written to a CURRENT monitor record.

    Priority: stable id, then serial, then exact name, then a bare integer index.
    The index is last and exists only so snapshots written before stable ids still
    restore; a name carried on the same record is preferred over it.
    """
    ident = str(identifier)
    mons = _monitors()

    for m in mons:
        if stable_id(m) == ident:
            return m
    for m in mons:
        if m.get('serial') and str(m.get('serial')) == ident:
            return m
    for m in mons:
        if str(m.get('name')) == ident:
            return m
    if ident.isdigit():
        idx = int(ident)
        for m in mons:
            if m.get('index') == idx:
                return m
    return None


def get_displays():
    result = []
    for m in _monitors():
        try:
            brightness = sbc.get_brightness(display=m['index'])[0]
        except Exception:
            continue
        result.append({
            "id": stable_id(m),
            "index": m.get('index'),
            "name": m.get('name'),
            "serial": m.get('serial'),
            "brightness": brightness,
        })
    print(json.dumps(result))


def set_master(value):
    try:
        sbc.set_brightness(value)
        print(json.dumps({"success": True}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


def set_brightness(identifier, value):
    m = _resolve(identifier)
    if m is None:
        print(json.dumps({"error": "no monitor matches " + str(identifier)}))
        return
    try:
        sbc.set_brightness(value, display=m['index'])
        print(json.dumps({
            "success": True,
            "resolved": m.get('name'),
            "index": m.get('index'),
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == 'get':
        get_displays()
    elif cmd == 'set_master':
        set_master(int(sys.argv[2]))
    elif cmd == 'set':
        set_brightness(sys.argv[2], int(sys.argv[3]))
