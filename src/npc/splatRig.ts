import {
  Color,
  type Matrix4,
  type MeshStandardMaterial,
  NormalBlending,
  type Object3D,
  Points,
  ShaderMaterial,
  type Skeleton,
  type SkinnedMesh,
  type Texture,
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

/**
 * Re-renders every SkinnedMesh under `root` as a cloud of soft circular point
 * sprites with gaussian falloff — visually approximating a 3D Gaussian Splat
 * scan of the character.
 *
 * The trick: we attach a `Points` object that *pretends* to be a SkinnedMesh
 * (`isSkinnedMesh = true`, plus the same skeleton/bindMatrix references). Three
 * keys off `object.isSkinnedMesh`, not the object's class, when it decides to
 * (a) inject the `USE_SKINNING` define + `skinIndex`/`skinWeight` attribute
 * prefixes into the shader, (b) bind the per-frame `bindMatrix`,
 * `bindMatrixInverse`, and `boneTexture` uniforms, and (c) call
 * `skeleton.update()` each frame to repack bone matrices. Drawing still
 * dispatches to `gl.POINTS` because the renderer's drawcall branch checks
 * `isMesh` first and our object only has `isPoints`. The original triangle
 * mesh is hidden — but stays in the scene graph so the AnimationMixer keeps
 * driving the bones.
 */
export function attachSplatRendering(root: Object3D): void {
  root.traverse((obj) => {
    const candidate = obj as Partial<SkinnedMesh> & Partial<Points> & Object3D;
    if (!candidate.isSkinnedMesh) return;
    // Our SkinnedPoints siblings also carry isSkinnedMesh=true so the renderer
    // auto-binds skinning uniforms for them — skip them on re-traversal so we
    // don't try to splatify our own splat point clouds.
    if (candidate.isPoints) return;
    const mesh = candidate as SkinnedMesh;
    if (mesh.userData.dweaSplatAttached) return;

    const material = (mesh.material as MeshStandardMaterial | undefined) ?? null;
    const map = material?.map ?? null;

    const points = new Points(mesh.geometry, createSplatMaterial(map)) as unknown as SkinnedPoints;
    points.isSkinnedMesh = true;
    points.skeleton = mesh.skeleton;
    points.bindMatrix = mesh.bindMatrix;
    points.bindMatrixInverse = mesh.bindMatrixInverse;
    points.bindMode = mesh.bindMode;
    // Skinned characters animate well outside their bind-pose AABB; the
    // renderer would frustum-cull the rest-pose box from the wrong place.
    points.frustumCulled = false;
    points.name = `${mesh.name || 'skinned'}-splat`;

    mesh.parent?.add(points);
    mesh.visible = false;
    mesh.userData.dweaSplatAttached = true;
  });
}

function createSplatMaterial(map: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    defines: map ? { USE_DIFFUSE_MAP: '' } : {},
    uniforms: {
      uPointSize: { value: 7.5 },
      uMap: { value: map },
      uTint: { value: new Color(0.92, 0.96, 1.05) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>

      uniform float uPointSize;
      varying vec2 vUv;
      varying float vFacing;

      void main() {
        vec3 transformed = position;
        vec3 objectNormal = normal;

        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Distance-attenuated point size, clamped at both ends so splats stay
        // visually consistent across the camera dolly range.
        float depth = max(-mvPosition.z, 0.1);
        gl_PointSize = clamp(uPointSize * (220.0 / depth), 2.0, 32.0);

        vUv = uv;
        vec3 viewN = normalize(normalMatrix * objectNormal);
        vFacing = clamp(viewN.z, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vFacing;

      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float r2 = dot(c, c);
        // 2D gaussian falloff. Coefficient picked so the visible disc covers
        // most of the sprite while edges fade smoothly into transparency.
        float alpha = exp(-r2 * 9.0);
        if (alpha < 0.04) discard;

        #ifdef USE_DIFFUSE_MAP
          vec3 base = texture2D(uMap, vUv).rgb;
        #else
          vec3 base = vec3(0.72, 0.78, 0.86);
        #endif

        // Subtle facing-the-camera highlight. Splats are baked color (no real
        // lighting), but a small viewspace-normal term keeps the silhouette
        // from looking flat from any single angle.
        float shade = 0.72 + 0.32 * vFacing;
        gl_FragColor = vec4(base * uTint * shade, alpha * 0.95);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
}
