import type { ThreeEvent } from '@react-three/fiber';
import { SCENE_GROUND_Y } from './movement.js';
import type { Vec2 } from './types.js';

/**
 * Invisible disk that catches pointer events on the XZ plane around the NPC.
 * Clicking it sets a new walk target. Sits a hair above the ground grid so
 * the click reads cleanly without z-fighting the grid.
 */
export interface GroundClickPlaneProps {
  onPick: (point: Vec2) => void;
  radius?: number;
}

export function GroundClickPlane({ onPick, radius = 6 }: GroundClickPlaneProps) {
  const handle = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onPick({ x: event.point.x, z: event.point.z });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 3D scene click; keyboard isn't applicable to a raycast surface.
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, SCENE_GROUND_Y + 0.001, 0]}
      onClick={handle}
      onPointerOver={() => {
        document.body.style.cursor = 'crosshair';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <circleGeometry args={[radius, 48]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
