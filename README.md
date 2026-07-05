# LoGeR Partial Align Viewer

Your site is live at https://shanehaku.github.io/GFM-loopclosure/

Open the viewer:

https://shanehaku.github.io/GFM-loopclosure/

This is a static Three.js viewer for LoGeR window-pair debug PLY files. It is meant for sharing alignment results in a browser without requiring CloudCompare or a local 3D tool.

## Viewer Contents

The page provides one 3D viewport with a left-side switcher for three groups:

1. `Original`: point cloud A + point cloud B
2. `LG aligned`: point cloud A + point cloud B after LightGlue + inlier/all matching line samples
3. `LG + VGICP`: point cloud A + point cloud B after LightGlue+VGICP + inlier/all matching line samples

Each group keeps its own camera, and each sub-item in the active group can be toggled independently. PLY coordinates are rendered as-is, so relative placement should match CloudCompare.

## Displayed Assets

```text
assets/
├── original/
│   ├── window_A_original_position_rgb.ply
│   └── window_B_original_position_rgb.ply
├── lg_aligned/
│   ├── window_A_lightglue_target_rgb.ply
│   ├── window_B_after_lightglue_rgb.ply
│   ├── lightglue_matching_lines.ply        # only inliers
│   └── lightglue_matching_lines_all.ply    # optional/debug all matches
└── lg_vgicp/
    ├── window_A_lightglue_vgicp_refine_target_rgb.ply
    ├── window_B_after_lightglue_vgicp_refine_rgb.ply
    ├── lightglue_matching_lines.ply        # only inliers
    └── lightglue_matching_lines_all.ply    # optional/debug all matches
```

The inlier matching-line layers are enabled by default. The `*_all.ply` debug layers are listed in the viewer but start disabled, so they can be toggled on only when needed.

## Local Preview

Do not open `index.html` with `file://`. Use a local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes

- Matching lines are exported as dense point samples along each line, and this viewer renders every PLY as points.
- For very large full-scene point clouds, use Potree instead.
