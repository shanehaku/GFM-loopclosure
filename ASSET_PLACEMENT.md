# Asset Placement

這個 template 只保留 whole map viewer。PLY 放在：

```text
maps/whole_map/
├── index.html
├── manifest.json
└── assets/
    ├── original/
    │   └── window_0_original_localmap_rgb.ply ... window_5_original_localmap_rgb.ply
    ├── no_loop_closure/
    │   └── window_0_no_loop_closure_rgb.ply ... window_5_no_loop_closure_rgb.ply
    ├── original_trajectories/
    │   ├── raw_loger_trajectory_viser_color_lines.ply
    │   └── adjacent_chain_stitched_trajectory_viser_color_lines.ply
    ├── colorbars/
    │   └── trajectory_viser_gist_rainbow_colorbar.png
    ├── sim3_graph/
    │   └── window_0_graph_optimized_rgb.ply ... window_5_graph_optimized_rgb.ply
    ├── two_node_submap/
    │   └── window_0_two_node_optimized_rgb.ply ... window_5_two_node_optimized_rgb.ply
    └── structure_deformation/
        └── window_0_graph_optimized_rgb.ply ... window_5_graph_optimized_rgb.ply
```

UI list 分成：

```text
Original
|original
|no loop closure
Optimized
|Sim3 Graph
|2node submap
|structure deformation
```

界面會先顯示 `Original` / `Optimized` 兩個選項；選到子項目時才載入該 map 的 6 個 PLY，避免一次載入全部資料。

如果輸出檔名不同，不用改程式，改 `maps/whole_map/manifest.json` 裡的 `path` 即可。
