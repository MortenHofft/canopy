import sys, time
sys.path.insert(0, "/home/user/gbif-phylo/spikes/parquet-experiment/convert")
import treearrays as ta
t=time.time(); a=ta.load_arrays(sys.argv[1], sys.argv[2]); print(sys.argv[1], len(a["parent"]), len(a["node_of_tip"]), a["has_len"], a["timing"], time.time()-t)
print("maxdepth", a["max_depth"][0], "maxcum", a["max_cum"][0], "named", sum(x is not None for x in a["name"]), "support", int((a["support"]==a["support"]).sum()))
