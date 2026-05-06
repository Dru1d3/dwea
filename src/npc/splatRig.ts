import {
  Color,
  type MeshStandardMaterial,
  NormalBlending,
  type Object3D,
  Points,
  ShaderChunk,
  ShaderMaterial,
  type SkinnedMesh,
  type Texture,
} from 'three';

/**
 * Re-renders every SkinnedMesh under `root` as a cloud of soft circular point
 * sprites with gaussian falloff — visually approximating a 3D Gaussian Splat
 * scan of the character. The original triangle mesh is hidden but kept in the
 * scene graph so animation continues to drive the skeleton; the splat shader
 * samples the same skeleton/bone-texture each frame, so the cloud follows the
 * rig's animation 1:1.
 */
export function attachSplatRendering(root: Object3D): void {
  root.traverse((obj) => {
    const candidate = obj as Partial<SkinnedMesh> & Object3D;
    if (!candidate.isSkinnedMesh) return;
    const mesh = candidate as SkinnedMesh;
    if (mesh.userData.dweaSplatAttached) return;

    const material = (mesh.material as MeshStandardMaterial | undefined) ?? null;
    const map = material?.map ?? null;

    // The renderer normally lazy-creates Skeleton.boneTexture the first time
    // it sets up skinning for a SkinnedMesh — but we hide the mesh, so that
    // path never runs. Force-init the texture now so our point cloud has a
    // stable uniform reference from frame zero.
    if (mesh.skeleton.boneTexture === null) {
      mesh.skeleton.computeBoneTexture();
    }

    const splatMaterial = createSplatMaterial(mesh, map);
    const points = new Points(mesh.geometry, splatMaterial);
    points.name = `${mesh.name || 'skinned'}-splat`;
    // Skinned characters animate well outside their bind-pose AABB; let the
    // renderer keep the points alive even when the rest pose's bbox would
    // frustum-cull them.
    points.frustumCulled = false;

    mesh.parent?.add(points);
    mesh.visible = false;
    mesh.userData.dweaSplatAttached = true;
  });
}

/**
 * Drives the bone texture for splat-rendered characters. Three.js only auto-
 * runs `Skeleton.update()` for SkinnedMeshes that are actually rendered, but
 * we hide the mesh — so we packs bone matrices into the texture ourselves
 * each frame. Call this from `useFrame` after the AnimationMixer ticks.
 */
export function refreshSplatSkeletons(root: Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<SkinnedMesh> & Object3D;
    if (!mesh.isSkinnedMesh) return;
    if (!mesh.userData.dweaSplatAttached) return;
    (mesh as SkinnedMesh).skeleton.update();
  });
}

function createSplatMaterial(mesh: SkinnedMesh, map: Texture | null): ShaderMaterial {
  return new ShaderMaterial({
    defines: {
      USE_SKINNING: '',
      ...(map ? { USE_DIFFUSE_MAP: '' } : {}),
    },
    uniforms: {
      bindMatrix: { value: mesh.bindMatrix },
      bindMatrixInverse: { value: mesh.bindMatrixInverse },
      boneTexture: { value: mesh.skeleton.boneTexture },
      uPointSize: { value: 7.5 },
      uMap: { value: map },
      uTint: { value: new Color(0.92, 0.96, 1.05) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 skinIndex;
      attribute vec4 skinWeight;

      ${ShaderChunk.common}
      ${ShaderChunk.skinning_pars_vertex}

      uniform float uPointSize;
      varying vec2 vUv;
      varying float vFacing;

      void main() {
        vec3 transformed = position;
        vec3 objectNormal = normal;

        ${ShaderChunk.skinbase_vertex}
        ${ShaderChunk.skinnormal_vertex}
        ${ShaderChunk.skinning_vertex}

        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Distance-attenuated point size so splats stay visually consistent
        // as the camera dollies. Cap at both ends to avoid 1px specks at
        // long range and screen-filling blobs up close.
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
        // most of the point sprite while edges fade smoothly into transparency.
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
