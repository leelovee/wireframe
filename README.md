# STL → .world Wireframe Converter (Web)

This web tool converts an input 3D object (STL type) into a lightweight `.world` wireframe 3D object composed of cylinders along edges for the "adult" 3D game.

## How it works
- Parses STL in-browser.
- Extracts triangle edges and deduplicates within ε (epsilon) tolerance.
- Builds with cylinder primitives with chosen `radius`, `color`, `material` and `scale`.
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
- Read the guide for complete explanations
- **Set the model size during conversion (Scale).** The exported `.world` uses this scale directly.
- Prefer low-polygons objects

### Making a low‑poly STL in Blender
- Blender → File → Import → STL
- Select the mesh, go to Modifiers → Add Modifier → Decimate
- Reduce Ratio (e.g. 0.1–0.5) while preserving shape
- Apply, then File → Export → STL
- Video tutorial link
  
See `guide.html` (and `guide.pdf`) in this folder for a walk-through with images.

## todo
- move up generated shapes over the sea level
- Group all shapes

## Derivative works
- The real hard part was to get right computations for position, scales, rotations,..
- Wireframe is just the use of the cylinder 3D primitive but it can be any built in objects
- All kibd of generative ideas are now possible, not only wireframe
- Like plant a forest with x tree of y species
- Imagination is your limit


