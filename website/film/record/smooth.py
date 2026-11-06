# smooth.py <video> : frame pacing and motion continuity.
# Timestamps: every delta must be exactly 1/fps. Motion: d[i] = mean |frame i - frame i-1| (luma, downscaled).
# A stall is a still frame between two moving ones (d[i-1] > t, d[i] ~ 0, d[i+1] > t); a jump is d[i] far above
# its neighbours' median (and not a cut the film makes on purpose: those are listed so they can be checked by eye).
import subprocess, sys, json, statistics
v = sys.argv[1]
ts = subprocess.run(['ffprobe','-v','error','-select_streams','v','-show_entries','frame=pts_time','-of','csv=p=0',v],capture_output=True,text=True).stdout.split()
ts = [float(x.strip(',')) for x in ts if x.strip(',')]
dt = [round(b-a,5) for a,b in zip(ts,ts[1:])]
bad = [ (i,d) for i,d in enumerate(dt) if abs(d-1/60) > 1e-3 ]
print(f'frames {len(ts)}  duration {ts[-1]+1/60:.3f}s  deltas min {min(dt):.5f} max {max(dt):.5f}  off-pace {len(bad)}')
raw = subprocess.run(['ffmpeg','-v','error','-i',v,'-vf','scale=320:-1,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-','-f','null','-'],capture_output=True,text=True).stdout
d = [float(l.split('=')[1]) for l in raw.splitlines() if 'YAVG' in l]
stalls = [i for i in range(1,len(d)-1) if d[i-1] > .25 and d[i] < .02 and d[i+1] > .25]
jumps = []
for i in range(3,len(d)-3):
    nb = statistics.median(d[i-3:i]+d[i+1:i+4])
    if d[i] > 2.5 and d[i] > 6*max(nb,.15): jumps.append((i+1, round(d[i],2), round(nb,2)))
print('stalls (still frame inside motion):', len(stalls), stalls[:20])
print('jumps (frame, diff, neighbours):', len(jumps), jumps[:30])
