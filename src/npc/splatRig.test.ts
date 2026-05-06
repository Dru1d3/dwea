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
import { attachSplatRendering } from './splatRig.js';

function makeRiggedScene(): { root: Group; mesh: SkinnedMesh } {
  const geometry = new BufferGeometry();
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
    expect(points?.geometry).toBe(mesh.geometry);
    expect(points?.frustumCulled).toBe(false);
  });

  it('flags the Points object as a SkinnedMesh so the renderer auto-binds skinning uniforms', () => {
    // This is the load-bearing trick: WebGLPrograms reads
    // `parameters.skinning = object.isSkinnedMesh === true` and
    // WebGLObjects.update calls `object.skeleton.update()` per frame on the
    // same flag. Without this, the splat shader runs against a zero bone
    // texture and every vertex collapses to the origin → invisible character.
    const { root, mesh } = makeRiggedScene();
    attachSplatRendering(root);
    const points = root.children.find((c): c is Points => (c as Points).isPoints === true);
    if (!points) throw new Error('expected Points sibling');

    const skinned = points as Points & {
      isSkinnedMesh?: boolean;
      skeleton?: typeof mesh.skeleton;
      bindMatrix?: typeof mesh.bindMatrix;
      bindMatrixInverse?: typeof mesh.bindMatrixInverse;
    };
    expect(skinned.isSkinnedMesh).toBe(true);
    expect(skinned.skeleton).toBe(mesh.skeleton);
    expect(skinned.bindMatrix).toBe(mesh.bindMatrix);
    expect(skinned.bindMatrixInverse).toBe(mesh.bindMatrixInverse);
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
