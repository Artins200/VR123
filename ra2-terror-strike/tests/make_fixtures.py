#!/usr/bin/env python3
"""Builds two throwaway folders that look like the two installed games, so the shipped
converter can be run end to end here. Nothing here is game content: the rule books and
archives are tiny hand-written stand-ins with the same shapes as the real files."""
import os, shutil, struct, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ts_e2e"
HOST = os.path.join(ROOT, "ra2")
CSS = os.path.join(ROOT, "css")

RULES = """; stand-in for the host game's own rules book
[General]
Name=Stand In
CrateRegen=0:03
CrateMoney=2000
UnitCrateType=E1
OreGrows=yes

[WeaponTypes]
1=M60
2=SniperGun

[M60]
Damage=15
ROF=20
Range=5
Projectile=InvisibleLow
Report=E1AttackA
Warhead=SA

[SniperGun]
Damage=100
ROF=60
Range=8
Projectile=InvisibleHigh
Report=SniperAttack
Warhead=HollowPoint

[Warheads]
1=SA
2=HollowPoint

[InfantryTypes]
1=E1
2=E2
3=GGI
4=SNIPE
5=TERROR

[E1]
Name=GI
Primary=M60
Cost=200

[E2]
Name=Conscript
Primary=M60
Cost=100

[GGI]
Name=Guardian GI
Primary=M60
Cost=400

[SNIPE]
Name=Sniper
Primary=SniperGun
Cost=600

[TERROR]
Name=Terrorist
Primary=M60
Cost=500
"""

ART = """; stand-in for the host game's own art book
[E1]
Cameo=SAICON
Sequence=E1Sequence

[E2]
Cameo=E2ICON
Sequence=E1Sequence

[GGI]
Cameo=GGIICON
Sequence=GGISequence
FireUp=3

[SNIPE]
Cameo=SNIPEICON
Sequence=E1Sequence

[TERROR]
Cameo=TERRORICON
Sequence=E1Sequence
"""

SOUND = """; stand-in for the host game's own sound book
[E1AttackA]
Sound=e1atta.wav
Priority=critical
Volume=85
"""


def mix_v2(files):
    """files: list of (bytes) payloads, ids assigned in order."""
    count = len(files)
    body = b"".join(files)
    header = struct.pack("<I", 0) + struct.pack("<H", count) + struct.pack("<I", len(body))
    index = b""
    off = 0
    for i, payload in enumerate(files):
        index += struct.pack("<III", 0x1000 + i, off, len(payload))
        off += len(payload)
    return header + index + body


def find_entry(mix_bytes, marker):
    """Mirrors the C reader so the fixture is checked the same way the game would be."""
    flags, = struct.unpack_from("<I", mix_bytes, 0)
    count, size = struct.unpack_from("<HI", mix_bytes, 4)
    hdr = 10
    body_start = hdr + count * 12
    for i in range(count):
        _id, off, sz = struct.unpack_from("<III", mix_bytes, hdr + i * 12)
        chunk = mix_bytes[body_start + off: body_start + off + sz]
        if marker in chunk:
            return chunk
    return None


def vtf_bgra(w, h, rgb):
    hdr = bytearray(80)
    hdr[0:4] = b"VTF\x00"
    struct.pack_into("<II", hdr, 4, 7, 2)
    struct.pack_into("<I", hdr, 12, 80)
    struct.pack_into("<HH", hdr, 16, w, h)
    hdr[52] = 12          # BGRA8888
    hdr[53] = 1           # one mipmap
    hdr[55] = 0
    hdr[56] = 0
    px = b""
    for _ in range(w * h):
        px += bytes([rgb[2], rgb[1], rgb[0], 255])
    return bytes(hdr) + px


def vpk_v1(entries):
    """entries: list of (ext, dir, name, payload). Everything is stored in the dir file."""
    tree = bytearray()
    body = bytearray()
    by_ext = {}
    for ext, d, name, payload in entries:
        by_ext.setdefault(ext, {}).setdefault(d, []).append((name, payload))
    for ext, dirs in by_ext.items():
        tree += ext.encode() + b"\x00"
        for d, files in dirs.items():
            tree += d.encode() + b"\x00"
            for name, payload in files:
                tree += name.encode() + b"\x00"
                tree += struct.pack("<IHHII", 0, 0, 0x7FFF, len(body), len(payload))
                tree += b"\xff\xff"
                body += payload
            tree += b"\x00"
        tree += b"\x00"
    tree += b"\x00"
    header = struct.pack("<III", 0x55AA1234, 1, len(tree))
    return header + bytes(tree) + bytes(body)


def wav_pcm(rate, seconds, freq=440):
    frames = int(rate * seconds)
    data = bytearray()
    for i in range(frames):
        s = int(12000 * ((i * freq // rate) % 2 * 2 - 1))
        data += struct.pack("<h", s)
    hdr = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    hdr += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
    hdr += b"data" + struct.pack("<I", len(data))
    return hdr + bytes(data)


def main():
    shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(os.path.join(CSS, "cstrike"), exist_ok=True)

    # ---- host ----
    os.makedirs(HOST, exist_ok=True)
    open(os.path.join(HOST, "gamemd.exe"), "wb").write(b"MZ\x90\x00")
    pal = bytes([min(63, i // 4) for i in range(768)])
    generic = mix_v2([RULES.encode(), ART.encode(), SOUND.encode(), pal])
    outer = mix_v2([generic])
    open(os.path.join(HOST, "ra2md.mix"), "wb").write(outer)
    assert find_entry(outer, b"[InfantryTypes]") is not None, "fixture mix has no rules"
    assert find_entry(outer, b"Sequence=") is not None, "fixture mix has no art"

    # ---- companion ----
    def script(damage, clip, cycle, rng):
        return ("WeaponData\n{\n"
                f'\t"MaxPlayerSpeed" "221"\n\t"Damage" "{damage}"\n\t"ClipSize" "{clip}"\n'
                f'\t"CycleTime" "{cycle}"\n\t"Range" "{rng}"\n'
                '\t// a comment\n}\n').encode()

    entries = [
        ("txt", "scripts", "weapon_ak47", script(36, 30, 0.10, 8192)),
        ("txt", "scripts", "weapon_m4a1", script(33, 30, 0.09, 8192)),
        ("txt", "scripts", "weapon_awp", script(115, 10, 1.50, 8192)),
        ("txt", "scripts", "weapon_deagle", script(54, 7, 0.22, 4096)),
        ("txt", "scripts", "weapon_c4", script(100, 1, 2.00, 256)),
        ("vtf", "materials/models/weapons/v_models/rif_ak47", "rif_ak47", vtf_bgra(8, 8, (120, 90, 60))),
        ("vtf", "materials/models/weapons/v_models/rif_m4a1", "rif_m4a1", vtf_bgra(8, 8, (70, 80, 90))),
        ("vtf", "materials/models/weapons/v_models/snip_awp", "snip_awp", vtf_bgra(8, 8, (40, 60, 40))),
        ("vtf", "materials/models/weapons/v_models/pist_deagle", "pist_deagle", vtf_bgra(8, 8, (180, 170, 150))),
        ("vtf", "materials/models/weapons/v_models/c4", "c4", vtf_bgra(8, 8, (200, 60, 50))),
        ("wav", "sound/weapons/ak47", "ak47-1", wav_pcm(44100, 0.02)),
        ("wav", "sound/weapons/m4a1", "m4a1_unsil-1", wav_pcm(44100, 0.02)),
        ("wav", "sound/weapons/awp", "awp1", wav_pcm(44100, 0.02)),
        ("wav", "sound/weapons/deagle", "deagle-1", wav_pcm(44100, 0.02)),
        ("wav", "sound/weapons/c4", "c4_beep1", wav_pcm(22050, 0.02)),
        ("wav", "sound/weapons/c4", "c4_plant", wav_pcm(22050, 0.02)),
        ("wav", "sound/weapons/c4", "c4_exp_deb1", wav_pcm(22050, 0.05)),
        ("wav", "sound/weapons/c4", "c4_disarm", wav_pcm(22050, 0.02)),
    ]
    open(os.path.join(CSS, "hl2.exe"), "wb").write(b"MZ\x90\x00")
    open(os.path.join(CSS, "cstrike", "cstrike_dir.vpk"), "wb").write(vpk_v1(entries))
    print("fixtures written to", ROOT)
    print("  host     :", HOST)
    print("  companion:", CSS)


if __name__ == "__main__":
    main()
