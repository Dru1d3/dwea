import { OrbitControls } from '@react-three/drei';

const ORBIT_TARGET: [number, number, number] = [0, 0, 0];

export function CameraRig() {
  return (
    <OrbitControls
      makeDefault
      target={ORBIT_TARGET}
      enableDamping
      dampingFactor={0.08}
      minDistance={1.2}
      maxDistance={14}
      zoomSpeed={0.7}
      rotateSpeed={0.7}
      panSpeed={0.7}
      screenSpacePanning
    />
  );
}
