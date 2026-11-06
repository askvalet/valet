#!/usr/bin/env python3
"""webp.py <in.mp4> <out.webp> <width> [quality] [fps]: an animated WebP, looping, 24 fps by default.

ffmpeg only decodes and scales; Pillow (libwebp) encodes. Every frame is stored whole (no partial-rectangle updates)
and there's a keyframe every second, so lossy patches can't pile up into blocky rectangles in blurred glass, which
ffmpeg's libwebp_anim did. GitHub, askvalet.dev and every current browser play it like a GIF.
"""
import os
import subprocess
import sys

from PIL import Image


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    src, out, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
    quality = int(sys.argv[4]) if len(sys.argv) > 4 else 78
    fps = int(sys.argv[5]) if len(sys.argv) > 5 else 24
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src],
        check=True, capture_output=True, text=True).stdout.strip().split(',')
    sw, sh = int(probe[0]), int(probe[1])
    height = round(sh * width / sw / 2) * 2
    dec = subprocess.Popen(
        ['ffmpeg', '-v', 'error', '-i', src, '-vf', f'fps={fps},scale={width}:{height}:flags=lanczos',
         '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    size = width * height * 3
    frames = []
    while True:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            break
        frames.append(Image.frombytes('RGB', (width, height), buf))
    if dec.wait() != 0 or not frames:
        sys.exit(f'could not decode {src}')
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=1000 / fps, loop=0, method=6,
                   minimize_size=False, allow_mixed=False, lossless=False, quality=quality, kmin=fps - 1, kmax=fps)
    print(f'{os.path.basename(out)} {os.path.getsize(out)} bytes {width}w q{quality} {fps}fps {len(frames)} frames')


main()
