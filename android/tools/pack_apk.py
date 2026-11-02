#!/usr/bin/env python3
"""Packs an aapt2-produced APK plus classes.dex into a zipalign-style APK.

- resources.arsc is stored UNCOMPRESSED and 4-byte aligned (required for
  targetSdkVersion >= 30).
- All other entries keep deflate compression; stored entries are aligned via
  an Android-style padding extra field (id 0xd935).

Usage: pack_apk.py <unsigned.apk> <classes.dex> <out.apk>
"""
import struct
import sys
import zipfile
import zlib

ALIGN = 4
ANDROID_PAD_EXTRA_ID = 0xD935


def local_header(name: bytes, extra: bytes, method: int, crc: int, csize: int, usize: int) -> bytes:
    return struct.pack(
        "<IHHHHHIIIHH",
        0x04034B50,      # local file header signature
        20,              # version needed
        0,               # flags
        method,          # compression method
        0,               # mod time
        0x21,            # mod date (1980-01-01)
        crc,
        csize,
        usize,
        len(name),
        len(extra),
    ) + name + extra


def central_header(name: bytes, method: int, crc: int, csize: int, usize: int, offset: int) -> bytes:
    return struct.pack(
        "<IHHHHHHIIIHHHHHII",
        0x02014B50,      # central directory signature
        20,              # version made by
        20,              # version needed
        0,               # flags
        method,
        0,               # mod time
        0x21,            # mod date
        crc,
        csize,
        usize,
        len(name),
        0,               # extra len (central)
        0,               # comment len
        0,               # disk number
        0,               # internal attrs
        0,               # external attrs
        offset,
    ) + name


def main(src_apk: str, dex_path: str, out_path: str) -> None:
    entries = []  # (name_bytes, data, method)
    with zipfile.ZipFile(src_apk) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            data = z.read(info.filename)
            method = zipfile.ZIP_STORED if info.filename == "resources.arsc" else zipfile.ZIP_DEFLATED
            entries.append((info.filename.encode("utf-8"), data, method))

    with open(dex_path, "rb") as f:
        entries.append((b"classes.dex", f.read(), zipfile.ZIP_DEFLATED))

    out = bytearray()
    central = bytearray()
    count = 0
    for name, data, method in entries:
        crc = zlib.crc32(data) & 0xFFFFFFFF
        if method == zipfile.ZIP_DEFLATED:
            comp = zlib.compressobj(9, zlib.DEFLATED, -15)
            cdata = comp.compress(data) + comp.flush()
        else:
            cdata = data

        offset = len(out)
        # padding so that the data starts ALIGN-byte aligned (for stored entries;
        # harmless for deflated ones but keeps the file uniformly aligned)
        base = offset + 30 + len(name)
        rem = base % ALIGN
        pad = (ALIGN - rem) % ALIGN if method == zipfile.ZIP_STORED else 0
        if pad:
            # valid extra field: id 0xd935 + size pad + pad zero bytes => total pad+4
            extra = struct.pack("<HH", ANDROID_PAD_EXTRA_ID, pad) + b"\x00" * pad
        else:
            extra = b""

        out += local_header(name, extra, method, crc, len(cdata), len(data))
        out += cdata
        central += central_header(name, method, crc, len(cdata), len(data), offset)
        count += 1

    cd_offset = len(out)
    out += central
    out += struct.pack(
        "<IHHHHIIH",
        0x06054B50,  # EOCD signature
        0, 0,
        count, count,
        len(central),
        cd_offset,
        0,
    )

    with open(out_path, "wb") as f:
        f.write(out)
    print(f"packed {count} entries -> {out_path} ({len(out)} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
