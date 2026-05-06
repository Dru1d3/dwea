import { OrbitControls } from '@react-three/drei';

// Look at a point ~1 m above the ground so the camera frames the scene at
// roughly chest height instead of staring at the floor.
const ORBIT_TARGET: [number, number, number] = [0, 1, 0];

export function CameraRig() {
  return (
    <OrbitControls
      makeDefault
      target={ORBIT_TARGET}
      enableDamping
      dampingFactor={0.08}
      // Open-world distance range: close enough to inspect a prop, far enough
      // to take in the horizon.
      minDistance={1.5}
      maxDistance={80}
      zoomSpeed={0.7}
      rotateSpeed={0.7}
      panSpeed={0.7}
      // Prevent the user from rolling under the ground; cap a few degrees
      // shy of horizontal so the horizon stays visible.
      maxPolarAngle={Math.PI / 2 - 0.05}
      minPolarAngle={0.1}
      screenSpacePanning
    />
  );
}
