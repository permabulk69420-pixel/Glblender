# Glblender

A local, VR-first GLB workshop for Meta Quest 3. Import an asset, select its components, adjust their transforms and materials, pull or bend its geometry, and export the result. Built with Three.js, WebXR and a static Vite build. No account, backend or model upload is required.

## Open the workshop

The GitHub Pages deployment is published by the **Deploy Glblender** workflow. The repository's Pages source must be **GitHub Actions**. Open the URL shown by the workflow's `github-pages` deployment.

The workshop starts with an editable **Kestrel Survey Shuttle**: named hull, canopy, frame, engines, wings, trim and landing skids. It is a real mesh assembly that can be edited and exported.

## Quest usage

1. Open the GitHub Pages HTTPS URL in the Quest browser.
2. Choose **Import model** and select a GLB from Downloads or another local folder. For a `.gltf`, select its `.bin` and image files alongside it. A self-contained `.glb` is recommended.
3. Choose **Enter VR**. The asset appears on the workbench at tabletop scale.
4. Point at a part and press trigger. Grip to move and rotate it; add the other grip to scale and rotate with both hands.
5. Use the floating panel's **Material**, **Shape**, and **Parts** tabs. The Y button hides or reopens the panel near you.
6. Choose **Export GLB**. The app returns to the browser and downloads `original-name-edited.glb`. A second download link remains in the status bar if the browser needs another click.

The in-VR Import button returns to the browser for the normal file picker. Browsers do not grant persistent access to arbitrary Quest filesystem paths.

### Controller bindings

| Input | Action |
| --- | --- |
| Trigger | Point and select; activate a panel control; hold on a surface in Shape mode to deform |
| Grip | Grab the pointed component, or the selected component if pointing into empty space |
| Both grips | Scale and rotate the grabbed component around the midpoint between your hands |
| Left thumbstick | Move around the workshop |
| Right thumbstick X, Object mode | 30° snap turn |
| Right thumbstick Y, Shape mode | Increase/decrease brush radius |
| A / B | Undo / redo |
| X | Toggle Object / Shape mode |
| Y | Hide the panel or reopen it near your head |

Choose **Select whole asset** to manipulate the full assembly. The Free/X/Y/Z constraint limits one-hand translation in the component's local axes. Free mode also follows wrist rotation; two hands perform uniform scale and rotation. Part scaling changes the exported model; **view scaling does not**.

## Desktop controls

| Input | Action |
| --- | --- |
| Click a mesh / tree row | Select a component or group |
| Left or right drag | Orbit; right drag also works in Shape mode |
| Shift + drag | Pan |
| Mouse wheel | Zoom |
| W / E / R | Translate / rotate / scale gizmo |
| Ctrl/Cmd Z | Undo |
| Ctrl/Cmd Shift Z or Ctrl/Cmd Y | Redo |
| F | Frame the asset |
| Escape | Cancel the current shape stroke or deselect |
| H / I / Delete | Hide/show / isolate / delete selected component |
| Left drag on a surface in Shape mode | Deform that region |

Transforms can also be entered numerically in the inspector. Material slots have base colour, metallic, roughness, opacity, emissive colour/intensity and double-sided controls. Each mesh's material is copied on edit so linked source materials do not recolour unrelated parts.

## Shape tools

- **Pull:** move a surface region with smooth proportional falloff.
- **Stretch:** stretch a region along the chosen local axis.
- **Squash:** compress/extend one axis while compensating the other two.
- **Flatten:** move the region toward the tangent plane of the selected face.
- **Bend:** apply constant curvature along X, Y or Z, anchored at that axis's minimum end. Desktop offers an angle and Apply button; VR offers ±15° steps and a trigger-drag bend.

Radius is measured in the asset's metres. The brush accounts for viewing scale and non-uniform component transforms. Positions are updated in an independent geometry buffer; normals and bounds refresh during and after a stroke. Undo stores the affected vertices once per completed stroke, rather than snapshotting the GLB every frame.

Bend works best along a component's long axis. Shape tools move existing vertices: a six-face cube will not acquire smooth curvature without more topology.

## Import, export and recovery

- Supports GLB and local multi-file GLTF, including bundled Draco, Meshopt and KTX2/Basis decoders. Runtime decoders are served with the app.
- Local asset references are resolved to the selected files. The importer does not fetch missing model resources from remote URLs.
- Keeps mesh hierarchy, source node names, transforms, material slots, geometry, UVs, textures, skins and supported animation tracks. Animations stay paused while editing.
- View-only tabletop/actual/custom scale and workshop objects are excluded from export.
- Hidden components are retained in exports; hide/lock state is stored as Glblender metadata. Other GLTF viewers may show hidden parts because standard GLTF has no general node-visibility field. Isolating a part never discards the rest of the model.
- Deleted components are omitted from export and can be restored with Undo during the current session.
- IndexedDB saves the latest asset a few seconds after editing stops. Recovery is offered after reload. Undo history is session-only. Browser storage is not a replacement for exported backups.
- Recovery pauses for assets above 80 MB or if browser storage is unavailable; normal export remains available.

## Run locally

Requires Node.js 22+.

```bash
npm ci
npm run dev
```

The local server uses port 5175. To open an immersive WebXR session on a headset, serve the app over HTTPS; ordinary remote HTTP origins cannot request WebXR.

```bash
npm test
npm run build
npm run preview
```

The build copies the required decoder files from the pinned Three.js package into the output. Vite's relative base supports the GitHub Pages repository subpath.

## Deployment and checks

Push to `main`. The GitHub Actions workflow installs dependencies, runs the geometry/history/export/controller tests, builds the production app, and runs a Chromium smoke test before publishing `dist/` to Pages.

The Chromium test imports a sample GLB through the actual file input, edits transforms/materials, bends and locks a component, downloads and parses the exported GLB, reimports it, checks session recovery, and captures desktop/mobile screenshots. Its results are uploaded as the **browser-checks** workflow artifact. It runs against synthetic sample data, never personal files.

To run the optional browser test locally after a build:

```bash
npm install --no-save --package-lock=false playwright@1.51.1
npx playwright install chromium
node tests/browser-smoke.mjs
```

Synthetic controller tests cover one-hand offset, two-hand scale/rotation, hand transitions, axis constraints, locks, and undo/redo bindings. Physical headset rendering, file-picker behavior and controller ergonomics still require testing on a Quest.

## Generating assets for this editor

Ask your 3D generator for:

- Separate descriptive meshes: `Hull`, `Canopy`, `CanopyFrame`, `Dashboard`, `Seat`, `EngineHousing`, `LandingGear`, `Trim`.
- Sensible object pivots and a clean parent hierarchy.
- Metres, with scale applied where practical. GLTF is interpreted as metres; the editor cannot infer a generator's intended units.
- Moderate, evenly spaced topology in regions that need to bend or deform.
- Separate material slots for distinct surfaces, with usable UVs and embedded textures.
- A self-contained GLB without unnecessary merged geometry or extreme texture/triangle counts.

An asset containing only one merged mesh still supports shape editing, but the editor cannot recover missing semantic components automatically.

## Current limits

- This is a component and proportional-editing workshop, not a full modelling package. There is no topology creation, remeshing, mesh splitting, boolean modelling, UV editing or animation authoring.
- Shape tools require a static mesh. Rigged, instanced and morph-target meshes preserve their data and support material editing, but cannot be sculpted. Duplicating rigged assemblies is disabled.
- Imported animation tracks are retained. Playing an exported animation in another application can override manual edits to animated transforms.
- Rotations under non-uniformly scaled ancestors cannot perfectly represent arbitrary shear as GLTF TRS. Apply parent scales before import for the most predictable transforms.
- Deformation warns above 100,000 vertices, refuses a single brush stroke over 300,000 affected vertices, and refuses meshes above one million vertices. High triangle counts and many materials can reduce headset frame rate.
- Undo retains up to 100 operations with a 64 MB soft budget. A single oversized operation is retained so the most recent edit remains undoable.
- Multi-file GLTF selection cannot disambiguate identical resource basenames from different folders unless relative paths are available; package those assets as GLB.

## Source layout

`src/core/` owns the scene, asset lifecycle, selection, history, export and recovery. `src/tools/` contains transform/material/deformation operations. `src/xr/` maps Quest input onto those operations and draws the floating panel. `src/ui/` owns the desktop inspector. Both interfaces share the same asset and edit history.
