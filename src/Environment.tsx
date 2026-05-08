import { Grid, Sky } from '@react-three/drei';
import { dustOchre, pearlNeutral, siennaDeep, skyBright } from './visual/palette.js';

export type EnvironmentProps = {
  /** World Y of the ground plane (metres). Defaults to 0 (clean metric). */
  readonly groundY?: number;
};

/**
 * Open-world lighting + horizon. Hemisphere + sun give a believable outdoor
 * feel even before a splat loads, and drei's <Sky> draws an analytic sky dome
 * out at infinity so there is no visible scene boundary.
 *
 * The grid is the synthetic floor — useful as a metric reference, semi-faded
 * so it does not dominate over the splat photogrammetry.
 */
export function Environment({ groundY = 0 }: EnvironmentProps) {
  return (
    <>
      {/* Soft fill so shadowed splats are not pitch black */}
      <ambientLight intensity={0.5} />
      {/* Sky/ground hemisphere — cool zenith, warm earth bounce. Tokens map
          §5.1 sky-bright (Clearing slot) and sienna-deep (Mara markings — the
          warmest dark in palette). */}
      <hemisphereLight args={[skyBright, siennaDeep, 0.55]} />
      {/* Key light: a 'sun' from a high angle */}
      <directionalLight position={[20, 30, 12]} intensity={1.05} />

      {/* Analytic sky dome. Position the sun roughly in the lighting direction
          so highlights and the sky agree. */}
      <Sky
        distance={450000}
        sunPosition={[20, 30, 12]}
        inclination={0.49}
        azimuth={0.25}
        turbidity={6}
        rayleigh={1.2}
        mieCoefficient={0.005}
        mieDirectionalG={0.8}
      />

      {/* Metric reference grid. 1 m cells, 10 m sections. Fades at distance
          to suggest open horizon rather than a hard boundary. */}
      <Grid
        position={[0, groundY + 0.001, 0]}
        args={[200, 200]}
        cellSize={1}
        cellThickness={0.5}
        cellColor={pearlNeutral}
        sectionSize={10}
        sectionThickness={1.0}
        sectionColor={dustOchre}
        fadeDistance={120}
        fadeStrength={1.2}
        infiniteGrid
        followCamera={false}
      />
    </>
  );
}
