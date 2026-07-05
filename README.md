# LoGeR Partial Align GitHub Pages Viewer

This is a static Three.js viewer for LoGeR window-pair debug PLY files.

It shows one display viewport with a left-side switcher for three groups:

1. `Original`: point cloud A + point cloud B
2. `LG aligned`: point cloud A + point cloud B after LightGlue + inlier/all matching line samples
3. `LG + VGICP`: point cloud A + point cloud B after LightGlue+VGICP + inlier/all matching line samples

Each group keeps its own camera, and each sub-item in the active group can be toggled independently.
PLY coordinates are rendered as-is, so relative placement should match CloudCompare.

## 1. Put files into the expected folders

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

Edit `manifest.json` if your filenames differ.

## 2. Local test

Do not open `index.html` with `file://`. Use a local server:

```bash
cd loger_github_pages_ply_viewer
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## 3. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Add LoGeR PLY viewer"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

Then in GitHub:

```text
Settings → Pages → Build and deployment → Deploy from branch → main / root
```

Your page will be:

```text
https://<USER>.github.io/<REPO>/
```

## 4. Large file checks

GitHub repositories reject files over 100 MiB. Check before push:

```bash
find . -type f -printf "%s %p\n" | sort -nr | head -20
du -sh .
```

If a file is close to 100 MiB, downsample it or use external storage.

## 5. Notes

- Matching lines should be exported as `line_samples.ply`, i.e. many colored points along the line. This viewer renders every PLY as points.
- If you need true line segments later, export matching lines as JSON pairs and add a `LineSegments` loader.
- For very large full-scene point clouds, use Potree instead.
