#!/bin/bash
# webp.sh <in.mp4> <out.webp> <width> [quality] [fps]: an animated WebP, looping, 24 fps, quality 78 by default.
# webp.py does the work: Pillow stores every frame whole with a keyframe each second, so no blocky patches build up
# in blurred glass (ffmpeg's libwebp_anim made them). The camera moves the whole frame, which a GIF can only store as
# new pixels everywhere (15-20 MB for 20 s); WebP keeps it near 3 MB.
exec python3 "$(dirname "$0")/webp.py" "$@"
