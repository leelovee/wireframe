/* STL -> .world converter (client-side) */

// ASCII STL parser
function parseAsciiSTL(text) {
  const lines = text.replace(/\r\n?|\n/g, '\n').split('\n');
  const tris = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (/^facet\s+normal/i.test(ln)) {
      // expect outer loop + 3x vertex + endloop + endfacet
      i++;
      if (i < lines.length && /^outer\s+loop/i.test(lines[i].trim())) {
        const verts = [];
        i++;
        for (let k = 0; k < 3 && i < lines.length; k++, i++) {
          const vln = lines[i].trim();
          if (/^vertex\b/i.test(vln)) {
            const parts = vln.split(/\s+/).filter(Boolean);
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
            verts.push([x, y, z]);
          }
        }
        // endloop
        if (i < lines.length && /^endloop/i.test(lines[i].trim())) i++;
        // endfacet
        if (i < lines.length && /^endfacet/i.test(lines[i].trim())) {}
        if (verts.length === 3) tris.push(verts);
      }
    }
  }
  return tris; // [[v1,v2,v3],...]
}

// Binary STL detection and parser
// Heuristic similar to three.js STLLoader: prefer ASCII if header starts with 'solid' and contains 'facet'
function looksAsciiSTL(buffer) {
  const dec = new TextDecoder();
  const header = dec.decode(new Uint8Array(buffer.slice(0, Math.min(512, buffer.byteLength))));
  if (!/^\s*solid\b/i.test(header)) return false;
  // If we see 'facet' after 'solid', likely ASCII
  if (/\bfacet\b/i.test(header)) return true;
  // Some binaries misuse 'solid' — fall through
  return false;
}

function isBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const expected = 84 + triCount * 50;
  if (expected === buffer.byteLength) return true;
  // Fallback: if not confidently ASCII, treat as binary
  return !looksAsciiSTL(buffer);
}

function parseBinarySTL(buffer) {
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const tris = [];
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    // skip normal (3 floats)
    const x1 = dv.getFloat32(off + 12, true);
    const y1 = dv.getFloat32(off + 16, true);
    const z1 = dv.getFloat32(off + 20, true);
    const x2 = dv.getFloat32(off + 24, true);
    const y2 = dv.getFloat32(off + 28, true);
    const z2 = dv.getFloat32(off + 32, true);
    const x3 = dv.getFloat32(off + 36, true);
    const y3 = dv.getFloat32(off + 40, true);
    const z3 = dv.getFloat32(off + 44, true);
    tris.push([[x1,y1,z1],[x2,y2,z2],[x3,y3,z3]]);
    off += 50; // 12*4 + 2 bytes attr
  }
  return tris;
}

function round6(x) { return Math.round(x * 1e6) / 1e6; }

function vecLen(v) { return Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); }

function cylinderTransform(A, B) {
  const v = [B[0]-A[0], B[1]-A[1], B[2]-A[2]];
  const L = vecLen(v);
  if (L === 0) return { p: [A[0],A[1],A[2]], r: [0,0,0], s: [0.008,0.008,1e-6] };
  const ry = Math.atan2(v[0], v[2]) * 180 / Math.PI;
  const rx = -Math.asin(Math.max(-1, Math.min(1, v[1]/L))) * 180 / Math.PI;
  const rz = 0;
  return { p: [A[0],A[1],A[2]], r: [rx, ry, rz], s: [0.008, 0.008, L] };
}

function dedupVertices(tris, eps) {
  const idx = new Map();
  const verts = [];
  const triIdx = [];
  function keyOf(p) {
    const rx = Math.round(p[0]/eps)*eps;
    const ry = Math.round(p[1]/eps)*eps;
    const rz = Math.round(p[2]/eps)*eps;
    return `${rx},${ry},${rz}`;
  }
  function getIndex(p) {
    const k = keyOf(p);
    if (idx.has(k)) return idx.get(k);
    const id = verts.length;
    idx.set(k, id);
    verts.push(p.map(v=>v));
    return id;
  }
  for (const t of tris) {
    const a = getIndex(t[0]);
    const b = getIndex(t[1]);
    const c = getIndex(t[2]);
    triIdx.push([a,b,c]);
  }
  return { verts, triIdx };
}

function edgesFromTris(triIdx) {
  const set = new Set();
  function add(a,b){ const lo=Math.min(a,b), hi=Math.max(a,b); set.add(`${lo},${hi}`); }
  for (const [a,b,c] of triIdx) {
    add(a,b); add(b,c); add(c,a);
  }
  const edges = [];
  for (const s of set) { const [i,j]=s.split(',').map(n=>parseInt(n)); edges.push([i,j]); }
  return edges;
}

function toHexColor(rgb) {
  // rgb in [0..1]
  const r = Math.round(rgb[0]*255).toString(16).padStart(2, '0');
  const g = Math.round(rgb[1]*255).toString(16).padStart(2, '0');
  const b = Math.round(rgb[2]*255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function fromHexColor(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return [0,0,0];
  return [ parseInt(m[1],16)/255, parseInt(m[2],16)/255, parseInt(m[3],16)/255 ];
}

function buildWorld(objects, bbox) {
  const [minx,miny,minz,maxx,maxy,maxz] = bbox;
  const cx = (minx+maxx)/2, cy = (miny+maxy)/2, cz = (minz+maxz)/2;
  const dx = maxx-minx, dy=maxy-miny, dz=maxz-minz;
  const diag = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
  const respawn = { p: [cx, cy + 0.25*diag, cz - 2*diag], r: 180.0 };
  return {
    respawn,
    ambient: Array(12).fill(1.0),
    oceanlevel: 0.0,
    weather: 'Day',
    valuetype: 'float',
    objects
  };
}

function adaptiveDigitsFromDiag(diag) {
  // Mimic Python adaptive precision: larger models -> fewer digits
  if (diag >= 10000) return 2;
  if (diag >= 1000) return 3;
  if (diag >= 100) return 4;
  if (diag >= 10) return 5;
  return 6;
}

function roundND(x, nd) { const f = Math.pow(10, nd); return Math.round(x * f) / f; }

function roundWorld(obj, ndigits) {
  if (typeof obj === 'number') return roundND(obj, ndigits);
  if (Array.isArray(obj)) return obj.map(v=>roundWorld(v, ndigits));
  if (obj && typeof obj === 'object') { const o={}; for (const k in obj) o[k]=roundWorld(obj[k], ndigits); return o; }
  return obj;
}

// Custom JSON stringifier to force decimal numbers (e.g., 1.0 instead of 1)
function jsonStringifyFloats(value, ndigits, indent=2) {
  const k = Math.max(1, ndigits|0); // ensure at least 1 decimal place
  const sp = typeof indent === 'number' ? ' '.repeat(indent) : (indent||'');

  function fmtNum(n) {
    if (!isFinite(n)) return '0.0';
    return Number(n).toFixed(k);
  }
  function escStr(s) { return JSON.stringify(s); }

  function write(val, depth) {
    const pad = sp ? sp.repeat(depth) : '';
    const padIn = sp ? sp.repeat(depth+1) : '';
    if (val === null) return 'null';
    const t = typeof val;
    if (t === 'number') return fmtNum(val);
    if (t === 'string') return escStr(val);
    if (t === 'boolean') return val ? 'true' : 'false';
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      const parts = val.map(v => (sp ? `\n${padIn}` : '') + write(v, depth+1));
      const closePad = sp ? `\n${pad}` : '';
      return `[${parts.join(',')}${closePad}]`;
    }
    if (t === 'object') {
      const keys = Object.keys(val);
      if (keys.length === 0) return '{}';
      const parts = keys.map(k2 => {
        const keyStr = escStr(k2);
        const vStr = write(val[k2], depth+1);
        return (sp ? `\n${padIn}` : '') + `${keyStr}:${sp? ' ': ''}${vStr}`;
      });
      const closePad = sp ? `\n${pad}` : '';
      return `{${parts.join(',')}${closePad}}`;
    }
    // fallback
    return 'null';
  }
  return write(value, 0);
}

function computeBBox(verts) {
  let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
  for (const p of verts) {
    if (p[0]<minx) minx=p[0]; if (p[0]>maxx) maxx=p[0];
    if (p[1]<miny) miny=p[1]; if (p[1]>maxy) maxy=p[1];
    if (p[2]<minz) minz=p[2]; if (p[2]>maxz) maxz=p[2];
  }
  if (!isFinite(minx)) return [0,0,0,0,0,0];
  return [minx,miny,minz,maxx,maxy,maxz];
}

(async function main(){
  const el = (id)=>document.getElementById(id);
  const stlFile = el('stlFile');
  const btnLoad = el('btnLoad');
  const btnConvert = el('btnConvert');
  const btnSave = el('btnSave');
  const status = el('status');
  const canvas = el('previewCanvas');
  const btnFit = el('btnFit');

  let tris = null;
  let verts = null;
  let triIdx = null;
  let edgesCache = null;

  // Three.js preview
  let scene, camera, renderer, controls, linesObj;
  let bboxCache = null;
  // Lightweight built-in mouse controls (no dependencies)
  const SC = {
    enabled: true,
    target: {x:0,y:0,z:0},
    theta: 0, // around Z
    phi: Math.PI/3, // from Z
    distance: 2,
    state: 'idle', // 'rotate' | 'pan' | 'idle'
    lastX: 0,
    lastY: 0
  };

  function scUpdateCamera() {
    if (!camera) return;
    const {target, theta, phi, distance} = SC;
    const sinp = Math.sin(phi), cosp = Math.cos(phi);
    const cost = Math.cos(theta), sint = Math.sin(theta);
    const x = target.x + distance * sinp * cost;
    const y = target.y + distance * sinp * sint;
    const z = target.z + distance * cosp;
    camera.position.set(x,y,z);
    camera.lookAt(target.x, target.y, target.z);
  }

  function scSetFromCamera() {
    if (!camera) return;
    const t = SC.target;
    const dx = camera.position.x - t.x;
    const dy = camera.position.y - t.y;
    const dz = camera.position.z - t.z;
    const r = Math.max(1e-6, Math.sqrt(dx*dx+dy*dy+dz*dz));
    SC.distance = r;
    SC.theta = Math.atan2(dy, dx);
    SC.phi = Math.acos(Math.max(-1, Math.min(1, dz / r)));
  }

  function scSetTargetFromBBox(b) {
    if (!b) return;
    const cx = (b.min[0]+b.max[0])/2;
    const cy = (b.min[1]+b.max[1])/2;
    const cz = (b.min[2]+b.max[2])/2;
    const sx = b.max[0]-b.min[0];
    const sy = b.max[1]-b.min[1];
    const sz = b.max[2]-b.min[2];
    const radius = Math.max(sx, sy, sz) * 0.6 || 1.0;
    SC.target = {x:cx,y:cy,z:cz};
    SC.distance = Math.max(0.001, radius * 2.5);
    scUpdateCamera();
  }

  function scAttach(canvasEl) {
    if (!canvasEl) return;
    // Prevent browser scrolling/zooming on canvas
    try { canvasEl.style.touchAction = 'none'; } catch(_) {}
    const active = new Map(); // pointerId -> {x,y}
    const gesture = {
      mode: 'idle', // 'idle' | 'rotate' | 'pan' | 'gesture'
      startDist: 0,
      startMid: {x:0,y:0},
      startTheta: 0,
      startPhi: 0,
      startDistance: 0,
      startTarget: {x:0,y:0,z:0}
    };
    canvasEl.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const scale = Math.pow(1.0015, e.deltaY); // smooth zoom
      SC.distance = Math.max(0.0001, Math.min(1e9, SC.distance * scale));
      scUpdateCamera();
    }, { passive: false });

    canvasEl.addEventListener('pointerdown', (e)=>{
      active.set(e.pointerId, {x:e.clientX, y:e.clientY});
      canvasEl.setPointerCapture(e.pointerId);
      if (active.size === 1) {
        // Single pointer -> rotate (mouse left or touch)
        SC.state = (e.button === 0 || e.pointerType === 'touch') ? 'rotate' : 'pan';
        SC.lastX = e.clientX; SC.lastY = e.clientY;
      } else if (active.size === 2) {
        // Two pointers -> gesture (pinch + pan)
        const pts = Array.from(active.values());
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        gesture.startDist = Math.hypot(dx, dy) || 1;
        gesture.startMid = {x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2};
        gesture.startTheta = SC.theta;
        gesture.startPhi = SC.phi;
        gesture.startDistance = SC.distance;
        gesture.startTarget = {x:SC.target.x, y:SC.target.y, z:SC.target.z};
        gesture.mode = 'gesture';
      }
    });
    canvasEl.addEventListener('pointerup', (e)=>{
      active.delete(e.pointerId);
      canvasEl.releasePointerCapture(e.pointerId);
      if (active.size === 0) { SC.state = 'idle'; gesture.mode = 'idle'; }
      if (active.size === 1) { SC.state = 'rotate'; gesture.mode = 'idle'; }
    });
    canvasEl.addEventListener('pointercancel', (e)=>{
      active.delete(e.pointerId);
      SC.state = 'idle'; gesture.mode = 'idle';
    });
    canvasEl.addEventListener('pointermove', (e)=>{
      if (gesture.mode === 'gesture') {
        if (active.size < 2) { gesture.mode = 'idle'; return; }
        active.set(e.pointerId, {x:e.clientX, y:e.clientY});
        const pts = Array.from(active.values());
        if (pts.length < 2) return;
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const mid = {x:(pts[0].x+pts[1].x)/2, y:(pts[0].y+pts[1].y)/2};
        // Pinch zoom
        const scale = gesture.startDist / dist;
        SC.distance = Math.max(0.0001, Math.min(1e9, gesture.startDistance * scale));
        // Pan by midpoint delta
        const mdx = mid.x - gesture.startMid.x;
        const mdy = mid.y - gesture.startMid.y;
        const panSpeed = SC.distance * 0.0015;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        up.copy(camera.up).normalize();
        SC.target.x = gesture.startTarget.x + (-mdx * panSpeed) * right.x + (mdy * panSpeed) * up.x;
        SC.target.y = gesture.startTarget.y + (-mdx * panSpeed) * right.y + (mdy * panSpeed) * up.y;
        SC.target.z = gesture.startTarget.z + (-mdx * panSpeed) * right.z + (mdy * panSpeed) * up.z;
        scUpdateCamera();
        return;
      }

      if (SC.state === 'idle') return;
      active.set(e.pointerId, {x:e.clientX, y:e.clientY});
      const dx = e.clientX - SC.lastX;
      const dy = e.clientY - SC.lastY;
      SC.lastX = e.clientX; SC.lastY = e.clientY;
      if (SC.state === 'rotate') {
        SC.theta -= dx * 0.005;
        SC.phi   -= dy * 0.005;
        const eps = 1e-4;
        SC.phi = Math.max(eps, Math.min(Math.PI - eps, SC.phi));
        scUpdateCamera();
      } else if (SC.state === 'pan') {
        const panSpeed = SC.distance * 0.0015;
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        right.crossVectors(fwd, camera.up).normalize();
        up.copy(camera.up).normalize();
        SC.target.x += (-dx * panSpeed) * right.x + (dy * panSpeed) * up.x;
        SC.target.y += (-dx * panSpeed) * right.y + (dy * panSpeed) * up.y;
        SC.target.z += (-dx * panSpeed) * right.z + (dy * panSpeed) * up.z;
        scUpdateCamera();
      }
    }, { passive: false });
  }

  function init3D() {
    if (!canvas) return;
    if (typeof THREE === 'undefined') {
      if (status) status.textContent = '3D disabled: Three.js not loaded. Check Internet or bundle three.min.js locally.';
      return;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1014);
    const rect0 = canvas.getBoundingClientRect();
    const w = (rect0.width || canvas.clientWidth || 800);
    const h = (rect0.height || canvas.clientHeight || 560);
    camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 10000);
    camera.position.set(0, 0.5, 2);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    try {
      if (THREE.OrbitControls) {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
      } else if (SC.enabled) {
        scAttach(renderer.domElement);
        scSetFromCamera();
      }
    } catch (e) {
      console.warn('OrbitControls unavailable, falling back to built-in controls.', e);
      scAttach(renderer.domElement); scSetFromCamera();
    }

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1,1,1);
    scene.add(dir);

    // Helpers to provide spatial reference
    try {
      const axes = new THREE.AxesHelper(0.5);
      axes.material.depthTest = false; axes.renderOrder = 2;
      scene.add(axes);
      const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
      grid.rotation.x = Math.PI/2; // align to XY plane (Z up)
      grid.material.opacity = 0.3; grid.material.transparent = true;
      scene.add(grid);
    } catch(_) {}

    function onResize() {
      const r = canvas.getBoundingClientRect();
      const w2 = r.width || canvas.clientWidth;
      const h2 = r.height || canvas.clientHeight;
      if (!w2 || !h2) return;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2, false);
    }
    window.addEventListener('resize', onResize);

    // Keep renderer in sync with element size changes
    try {
      const ro = new ResizeObserver(()=> onResize());
      ro.observe(canvas);
    } catch(_) {}

    (function animate(){
      requestAnimationFrame(animate);
      controls && controls.update();
      renderer && renderer.render(scene, camera);
    })();
  }

  function updatePreview(verts, edges, colorHex) {
    if (!scene || !THREE) return;
    if (linesObj) { try { scene.remove(linesObj); linesObj.geometry && linesObj.geometry.dispose(); linesObj.material && linesObj.material.dispose(); } catch(_){} linesObj = null; }
    if (!verts || !edges || edges.length === 0) return;
    const positions = new Float32Array(edges.length * 2 * 3);
    let p = 0;
    for (const [i,j] of edges) {
      const A = verts[i], B = verts[j];
      positions[p++] = A[0]; positions[p++] = A[1]; positions[p++] = A[2];
      positions[p++] = B[0]; positions[p++] = B[1]; positions[p++] = B[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: colorHex || '#ff0000' });
    linesObj = new THREE.LineSegments(geom, mat);
    scene.add(linesObj);
  }

  function fitView(bbox) {
    if (!camera || !controls || !bbox) return;
    const [minx,miny,minz,maxx,maxy,maxz] = bbox;
    const cx = (minx+maxx)/2, cy=(miny+maxy)/2, cz=(minz+maxz)/2;
    const dx=maxx-minx, dy=maxy-miny, dz=maxz-minz;
    const radius = Math.max(dx, dy, dz) * 0.6 || 1;
    const target = new THREE.Vector3(cx, cy, cz);
    controls.target.copy(target);
    const dir = new THREE.Vector3(0.8, 0.6, 1).normalize();
    const dist = radius / Math.tan((camera.fov * Math.PI/180) / 2) * 1.4;
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(dist*0.001, 0.01);
    camera.far = Math.max(dist*10, 1000);
    camera.updateProjectionMatrix();
  }

  btnLoad.addEventListener('click', async ()=>{
    const f = stlFile.files && stlFile.files[0];
    if (!f) { status.textContent = 'Please select an STL file.'; return; }
    const buf = await f.arrayBuffer();
    if (isBinarySTL(buf)) {
      tris = parseBinarySTL(buf);
      status.textContent = `Parsed binary STL. Triangles: ${tris.length}`;
    } else {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      tris = parseAsciiSTL(text);
      status.textContent = `Parsed ASCII STL. Triangles: ${tris.length}`;
    }
    if (!tris || tris.length === 0) {
      status.textContent = 'No triangles detected. Ensure the STL is valid.';
      return;
    }

    // Immediately build a preview from unique edges (no cylinders) using current UI params
    try {
      const eps = parseFloat(el('eps').value);
      const scale = parseFloat(el('scale').value);
      const hex = el('colorPicker').value;
      const ded = dedupVertices(tris, eps);
      verts = ded.verts.map(v=>[v[0]*scale, v[1]*scale, v[2]*scale]);
      triIdx = ded.triIdx;
      const edges = edgesFromTris(triIdx);
      edgesCache = edges;
      bboxCache = computeBBox(verts);
      updatePreview(verts, edges, hex);
      fitView(bboxCache);
      scSetTargetFromBBox(bboxCache);
      status.textContent += ` | Preview: edges ${edges.length}`;
    } catch (e) {
      console.warn('Preview on parse failed:', e);
    }
  });

  // Auto-parse as soon as a file is selected
  stlFile.addEventListener('change', ()=>{
    if (stlFile.files && stlFile.files[0]) btnLoad.click();
  });

  btnConvert.addEventListener('click', ()=>{
    if (!tris) { status.textContent = 'Load an STL first.'; return; }
    const eps = parseFloat(el('eps').value);
    const radius = parseFloat(el('radius').value);
    const scale = parseFloat(el('scale').value);
    const color = fromHexColor(el('colorPicker').value);
    const material = el('material').value || 'metal_4';

    const ded = dedupVertices(tris, eps);
    verts = ded.verts.map(v=>[v[0]*scale, v[1]*scale, v[2]*scale]);
    triIdx = ded.triIdx;
    const edges = edgesFromTris(triIdx);
    edgesCache = edges;

    let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
    const objects = [];
    for (const [i,j] of edges) {
      const A=verts[i], B=verts[j];
      const t = cylinderTransform(A,B);
      t.s[0] = t.s[1] = radius * scale;
      objects.push({ n:'Cylinder', p:t.p, r:t.r, s:t.s, c:color, m:material });
      // bbox update
      for (const p of [A,B]) {
        if (p[0]<minx) minx=p[0]; if (p[0]>maxx) maxx=p[0];
        if (p[1]<miny) miny=p[1]; if (p[1]>maxy) maxy=p[1];
        if (p[2]<minz) minz=p[2]; if (p[2]>maxz) maxz=p[2];
      }
    }

    bboxCache = [minx,miny,minz,maxx,maxy,maxz];
    const world = buildWorld(objects, bboxCache);
    const dx=bboxCache[3]-bboxCache[0], dy=bboxCache[4]-bboxCache[1], dz=bboxCache[5]-bboxCache[2];
    const diag = Math.sqrt(dx*dx+dy*dy+dz*dz) || 1;
    const ndigits = adaptiveDigitsFromDiag(diag);
    const rounded = roundWorld(world, ndigits);
    const json = jsonStringifyFloats(rounded, ndigits, 2);
    lastJsonOutput = json; // Store for saving
    btnSave.disabled = false;
    status.textContent = `Edges: ${edges.length}, Objects: ${objects.length}, Precision: ${ndigits} digits`;

    // Update 3D preview as fast line segments (ignores radius/material).
    try {
      const hex = el('colorPicker').value;
      updatePreview(verts, edges, hex);
      fitView(bboxCache);
      // Align simple controls to new bbox center
      scSetTargetFromBBox(bboxCache);
    } catch (e) {
      console.warn('Preview update failed:', e);
    }
  });

  btnSave.addEventListener('click', ()=>{
    if (!lastJsonOutput) {
      console.error('No .world content generated yet. Click Convert first.');
      return;
    }
    const fname = (stlFile.files[0]?.name || 'wireframe').replace(/\.stl$/i, '.world');
    const blob = new Blob([lastJsonOutput], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  if (btnFit) {
    btnFit.addEventListener('click', ()=> fitView(bboxCache));
  }

  // init 3D on load
  init3D();
})();
