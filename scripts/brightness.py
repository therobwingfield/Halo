import sys
import json
import screen_brightness_control as sbc

def get_displays():
    try:
        monitors = sbc.list_monitors()
        result = []
        for index, name in enumerate(monitors):
            try:
                brightness = sbc.get_brightness(display=index)[0]
                result.append({"id": str(index), "name": name, "brightness": brightness})
            except Exception as e:
                pass
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps([]))

def set_master(value):
    try:
        sbc.set_brightness(value)
        print(json.dumps({"success": True}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

def set_brightness(display_id, value):
    try:
        sbc.set_brightness(value, display=int(display_id))
        print(json.dumps({"success": True}))
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
