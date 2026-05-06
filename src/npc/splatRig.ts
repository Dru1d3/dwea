import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Matrix4,
  type MeshStandardMaterial,
  type Object3D,
  Points,
  ShaderMaterial,
  type Skeleton,
  type SkinnedMesh,
  type Texture,
  Vector3,
} from 'three';

/** A `Points` object that masquerades as a SkinnedMesh for skinning-uniform
 *  setup, while still drawing as `gl.POINTS`. */
interface SkinnedPoints extends Points {
  isSkinnedMesh: boolean;
  skeleton: Skeleton;
  bindMatrix: Matrix4;
  bindMatrixInverse: Matrix4;
  bindMode: 'attached' | 'detached';
}

/** Target splat count per character. The Soldier mesh has ~5k vertices —
 *  drawing those as Points gave a visibly under-sampled silhouette next to
 *  drei's ~100k+ environment splats. We surface-sample the rig's triangles
 *  to ~30k splats so the density reads in the same ballpark. */
const TARGET_SPLAT_COUNT = 30000;

/**
 * Re-renders every SkinnedMesh under `root` as a dense gaussian-splat-style
 * point cloud. We surface-sample the rig's triangles uniformly (area-weighted
 * barycentric sampling), inheriting skin weights from the closest source
 * vertex per sample, and wire the resulting `Points` through three.js's
 * built-in skinning pipeline by faking the SkinnedMesh contract on it.
 */
export function attachSplatRendering(root: Object3D): void {
  root.traverse((obj) => {
    const candidate = obj as Partial<SkinnedMesh> & Partial<Points> & Object3D;
    if (!candidate.isSkinnedMesh) return;
    // Our SkinnedPoints siblings also carry `isSkinnedMesh = true` so the
    // renderer auto-binds skinning uniforms for them — skip them on
    // re-traversal so we don't try to splatify our own splat point clouds.
    if (candidate.isPoints) return;
    const mesh = candidate as SkinnedMesh;
    if (mesh.userData.dweaSplatAttached) return;

    const material = (mesh.material as MeshStandardMaterial | undefined) ?? null;
    const map = material?.map ?? null;

    const splatGeometry = buildSplatGeometry(mesh.geometry, TARGET_SPLAT_COUNT);

    const points = new Points(splatGeometry, createSplatMaterial(map)) as unknown as SkinnedPoints;
    // Three.js keys the *entire* skinning pipeline (USE_SKINNING define +
    // skinIndex/skinWeight attribute prefix in WebGLPrograms, per-frame
    // skeleton.update in WebGLObjects, bindMatrix/bindMatrixInverse/boneTexture
    // uniform binding in setProgram) off `object.isSkinnedMesh === true`.
    // Setting these on a Points object gets us the full skinning pipeline at
    // gl.POINTS draw time, since the drawcall dispatch checks `isMesh` first.
    points.isSkinnedMesh = true;
    points.skeleton = mesh.skeleton;
    points.bindMatrix = mesh.bindMatrix;
    points.bindMatrixInverse = mesh.bindMatrixInverse;
    points.bindMode = mesh.bindMode;
    // Skinned characters animate well outside their bind-pose AABB.
    points.frustumCulled = false;
    points.name = `${mesh.name || 'skinned'}-splat`;

    mesh.parent?.add(points);
    mesh.visible = false;
    mesh.userData.dweaSplatAttached = true;
  });
}

/**
 * Surface-samples a triangle mesh into `count` points distributed uniformly by
 * triangle area, with random barycentric coordinates inside each chosen
 * triangle. Position/normal/uv interpolate across the three triangle vertices;
 * skinIndex and skinWeight are inherited from whichever source vertex has the
 * largest barycentric weight (a 4-bone splat point can't carry the full
 * triangle's interpolated 12-bone influence).
 */
function buildSplatGeometry(src: BufferGeometry, count: number): BufferGeometry {
  const positionAttr = src.attributes.position as BufferAttribute;
  const normalAttr = src.attributes.normal as BufferAttribute | undefined;
  const uvAttr = src.attributes.uv as BufferAttribute | undefined;
  const skinIndexAttr = src.attributes.skinIndex as BufferAttribute;
  const skinWeightAttr = src.attributes.skinWeight as BufferAttribute;
  const indexAttr = src.index;

  const triCount = indexAttr ? indexAttr.count / 3 : positionAttr.count / 3;
  const cumulativeArea = new Float32Array(triCount);
  const va = new Vector3();
  const vb = new Vector3();
  const vc = new Vector3();
  const ab = new Vector3();
  const ac = new Vector3();
  const cross = new Vector3();
  let totalArea = 0;
  for (let t = 0; t < triCount; t += 1) {
    const [a, b, c] = triCorners(indexAttr, t);
    va.fromBufferAttribute(positionAttr, a);
    vb.fromBufferAttribute(positionAttr, b);
    vc.fromBufferAttribute(positionAttr, c);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    totalArea += cross.crossVectors(ab, ac).length() * 0.5;
    cumulativeArea[t] = totalArea;
  }

  const outPosition = new Float32Array(count * 3);
  const outNormal = new Float32Array(count * 3);
  const outUv = new Float32Array(count * 2);
  const outSkinIndex = new Uint16Array(count * 4);
  const outSkinWeight = new Float32Array(count * 4);
  const outJitter = new Float32Array(count);

  const skinIndexArr = skinIndexAttr.array;
  const skinWeightArr = skinWeightAttr.array;

  const pa = new Vector3();
  const pb = new Vector3();
  const pc = new Vector3();
  const na = new Vector3();
  const nb = new Vector3();
  const nc = new Vector3();

  for (let i = 0; i < count; i += 1) {
    const r = Math.random() * totalArea;
    const t = pickTriangle(cumulativeArea, r);
    const [a, b, c] = triCorners(indexAttr, t);

    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    pa.fromBufferAttribute(positionAttr, a);
    pb.fromBufferAttribute(positionAttr, b);
    pc.fromBufferAttribute(positionAttr, c);
    outPosition[i * 3 + 0] = pa.x * w + pb.x * u + pc.x * v;
    outPosition[i * 3 + 1] = pa.y * w + pb.y * u + pc.y * v;
    outPosition[i * 3 + 2] = pa.z * w + pb.z * u + pc.z * v;

    if (normalAttr) {
      na.fromBufferAttribute(normalAttr, a);
      nb.fromBufferAttribute(normalAttr, b);
      nc.fromBufferAttribute(normalAttr, c);
      outNormal[i * 3 + 0] = na.x * w + nb.x * u + nc.x * v;
      outNormal[i * 3 + 1] = na.y * w + nb.y * u + nc.y * v;
      outNormal[i * 3 + 2] = na.z * w + nb.z * u + nc.z * v;
    } else {
      outNormal[i * 3 + 1] = 1;
    }

    if (uvAttr) {
      const ua = uvAttr.getX(a);
      const uay = uvAttr.getY(a);
      const ubx = uvAttr.getX(b);
      const uby = uvAttr.getY(b);
      const ucx = uvAttr.getX(c);
      const ucy = uvAttr.getY(c);
      outUv[i * 2 + 0] = ua * w + ubx * u + ucx * v;
      outUv[i * 2 + 1] = uay * w + uby * u + ucy * v;
    }

    // Inherit skinning from the dominant source vertex. Inheriting all three
    // and clamping to four influences would be more accurate but adds work
    // for a barely-visible quality bump on a humanoid mesh whose triangles
    // rarely span more than 1–2 skinning regions.
    const closest = w >= u && w >= v ? a : u >= v ? b : c;
    for (let k = 0; k < 4; k += 1) {
      outSkinIndex[i * 4 + k] = skinIndexArr[closest * 4 + k] ?? 0;
      outSkinWeight[i * 4 + k] = skinWeightArr[closest * 4 + k] ?? 0;
    }

    outJitter[i] = Math.random();
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(outPosition, 3));
  geo.setAttribute('normal', new BufferAttribute(outNormal, 3));
  geo.setAttribute('uv', new BufferAttribute(outUv, 2));
  geo.setAttribute('skinIndex', new BufferAttribute(outSkinIndex, 4));
  geo.setAttribute('skinWeight', new BufferAttribute(outSkinWeight, 4));
  geo.setAttribute('aJitter', new BufferAttribute(outJitter, 1));
  return geo;
}

function triCorners(index: BufferGeometry['index'], t: number): readonly [number, number, number] {
  if (index) {
    return [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)] as const;
  }
  return [t * 3, t * 3 + 1, t * 3 + 2] as const;
}

function pickTriangle(cumulative: Float32Array, target: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cumulative[mid] ?? 0) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function createSplatMaterial(map: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    defines: map ? { USE_DIFFUSE_MAP: '' } : {},
    uniforms: {
      uPointSize: { value: 5.5 },
      uMap: { value: map },
      uTint: { value: new Color(0.94, 0.97, 1.04) },
    },
    vertexShader: /* glsl */ `
      attribute float aJitter;

      #include <common>
      #include <skinning_pars_vertex>

      uniform float uPointSize;
      varying vec2 vUv;
      varying float vFacing;
      varying float vJitter;

      void main() {
        vec3 transformed = position;
        vec3 objectNormal = normal;

        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Distance-attenuated point size, with per-point jitter so the cloud
        // has organic, non-uniform splat sizes (real photogrammetry splats
        // never come out uniform). Clamp to keep silhouette readable.
        float depth = max(-mvPosition.z, 0.1);
        float jittered = uPointSize * (0.7 + aJitter * 0.7);
        gl_PointSize = clamp(jittered * (260.0 / depth), 2.0, 24.0);

        vUv = uv;
        vec3 viewN = normalize(normalMatrix * objectNormal);
        vFacing = clamp(viewN.z, 0.0, 1.0);
        vJitter = aJitter;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vFacing;
      varying float vJitter;

      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float r2 = dot(c, c);
        // 2D gaussian falloff. Soft alpha ramp; with alphaToCoverage, the
        // ramp is converted to MSAA coverage so we get soft-edged splats
        // without paying the transparency sort tax.
        float alpha = exp(-r2 * 8.0);
        if (alpha < 0.15) discard;

        #ifdef USE_DIFFUSE_MAP
          vec3 base = texture2D(uMap, vUv).rgb;
        #else
          vec3 base = vec3(0.72, 0.78, 0.86);
        #endif

        // Per-splat brightness jitter for the photographic noise feel of a
        // real splat scan, plus a small facing-the-camera term so the
        // silhouette reads three-dimensional from any angle.
        float bright = 0.9 + 0.2 * vJitter;
        float shade = 0.72 + 0.32 * vFacing;
        gl_FragColor = vec4(base * uTint * shade * bright, alpha);
      }
    `,
    // alphaToCoverage gives soft splat edges through MSAA coverage instead of
    // alpha blending, so we stay in the opaque queue (no painter-style sort
    // glitches between overlapping points) while still getting a soft fade.
    alphaToCoverage: true,
    transparent: false,
    depthWrite: true,
  });
}
