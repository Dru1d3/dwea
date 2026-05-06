import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  MeshStandardMaterial,
  Object3D,
  type Points,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import { attachSplatRendering, refreshSplatSkeletons } from './splatRig.js';

function makeRiggedScene(): { root: Group; mesh: SkinnedMesh } {
  const geometry = new BufferGeometry();
  // Two-vertex stub. Skinning chunks need skinIndex/skinWeight, plus
  // position/normal/uv to satisfy the Points shader.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0]), 2));
  geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0]), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4),
  );

  const material = new MeshStandardMaterial();
  const mesh = new SkinnedMesh(geometry, material);
  const bone = new Bone();
  const skeleton = new Skeleton([bone]);
  mesh.add(bone);
  mesh.bind(skeleton);

  const root = new Group();
  root.add(mesh);
  return { root, mesh };
}

describe('attachSplatRendering', () => {
  it('hides the SkinnedMesh and adds a sibling Points cloud', () => {
    const { root, mesh } = makeRiggedScene();
    attachSplatRendering(root);

    expect(mesh.visible).toBe(false);
    const points = root.children.find((c): c is Points => (c as Points).isPoints === true);
    expect(points).toBeDefined();
    // Points must share the SkinnedMesh's geometry so animated bones drive
    // the same vertex positions through the splat shader.
    expect(points?.geometry).toBe(mesh.geometry);
    // Skinned bbox is unreliable at rest pose, so we disable culling.
    expect(points?.frustumCulled).toBe(false);
  });

  it('force-initialises the bone texture for hidden meshes', () => {
    const { root, mesh } = makeRiggedScene();
    expect(mesh.skeleton.boneTexture).toBeNull();
    attachSplatRendering(root);
    expect(mesh.skeleton.boneTexture).not.toBeNull();
  });

  it('is idempotent and does not double-attach point clouds', () => {
    const { root } = makeRiggedScene();
    attachSplatRendering(root);
    attachSplatRendering(root);
    const points = root.children.filter((c) => (c as Points).isPoints === true);
    expect(points).toHaveLength(1);
  });

  it('skips non-skinned meshes', () => {
    const root = new Group();
    root.add(new Object3D());
    attachSplatRendering(root);
    expect(root.children.every((c) => (c as Points).isPoints !== true)).toBe(true);
  });
});

describe('refreshSplatSkeletons', () => {
  it('marks each attached skeleton bone texture for re-upload', () => {
    const { root, mesh } = makeRiggedScene();
    attachSplatRendering(root);
    const tex = mesh.skeleton.boneTexture;
    if (tex === null) throw new Error('expected boneTexture after attach');
    // three.js Texture exposes `needsUpdate` as a setter that bumps `version`
    // (no symmetric getter), so we observe the version bump rather than
    // reading `needsUpdate` back.
    const before = tex.version;
    refreshSplatSkeletons(root);
    expect(tex.version).toBeGreaterThan(before);
  });
});
