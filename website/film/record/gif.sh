#!/bin/bash
# gif.sh <in.mp4> <out.gif> <width> [pre-filter,]  — 15 fps, held frames merged (their delay carries the time),
# light temporal denoise so static glass stays identical between frames, one palette for the whole clip, ordered dither.
# Two passes: the second gives the last frame back the hold that merging took from it.
in=$1; out=$2; w=$3; pre=$4
vf="${pre}fps=15,scale=$w:-1:flags=lanczos,hqdn3d=0:0:8:8,mpdecimate=hi=512:lo=256:frac=0.5,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"
ffmpeg -v error -y -i "$in" -vf "$vf" -fps_mode vfr "$out"
src=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in"); got=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
fd=$(python3 -c "print(max(7, round(($src-$got)*100)+7))")
ffmpeg -v error -y -i "$in" -vf "$vf" -fps_mode vfr -final_delay $fd "$out"
echo "$(basename $out) $(stat -c%s $out) bytes $(ffprobe -v error -count_packets -show_entries stream=width,height,nb_read_packets -of csv=p=0 $out) src ${src}s final_delay ${fd}cs"
