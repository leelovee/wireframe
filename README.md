# STL → .world Wireframe Converter (Web)

This web tool converts an input STL mesh into a lightweight `.world` wireframe composed of cylinders along mesh edges.

## How it works
- Parses binary STL in-browser.
- Extracts triangle edges and deduplicates within ε (epsilon) tolerance.
- Builds cylinder primitives with chosen `radius`, `color`, `material` and `scale`.
- Provides a realtime WebGL preview via THREE.js.

## Quick start
1. Open `index.html` in a browser.
2. Load an STL via the "Load STL" card, then click "Parse".
3. In Parameters, set:
   - Cylinder Radius (thickness of wires)
   - Scale (overall model size); use `Fit View` to preview
   - Color, Material, Dedup ε
4. Click "Convert to .world", then "Save .world".

## Important tips
- **Set the model size during conversion (Scale).** The exported `.world` uses this scale directly.
- Prefer low-poly meshes for speed and clarity in wireframes.

### Making a low‑poly STL in Blender
- Blender → File → Import → STL
- Select the mesh, go to Modifiers → Add Modifier → Decimate
- Reduce Ratio (e.g. 0.1–0.5) while preserving shape
- Apply, then File → Export → STL

See `guide.html` (and `guide.pdf`) in this folder for a printable walk-through with images.
