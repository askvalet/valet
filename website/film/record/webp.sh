#!/bin/bash
# webp.sh <in.mp4> <out.webp> <width> [quality] : an animated WebP at 15 fps, looping. The camera moves the whole
# frame, which a GIF can only store as new pixels everywhere (15-20 MB for 20 s); WebP keeps it near 3 MB, and GitHub,
# askvalet.dev and every current browser play it like a GIF.
in=$1; out=$2; w=$3; q=${4:-70}
ffmpeg -v error -y -i "$in" -vf "fps=15,scale=$w:-1:flags=lanczos" -c:v libwebp_anim -lossless 0 -q:v $q -compression_level 6 -loop 0 "$out"
echo "$(basename $out) $(stat -c%s $out) bytes ${w}w q$q"
