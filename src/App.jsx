import { useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { TrackballControls } from '@react-three/drei'
import HomeOrb from './components/HomeOrb.jsx'

function ResponsiveCamera() {
  const { camera, size } = useThree()

  useEffect(() => {
    const aspect = size.width / Math.max(size.height, 1)

    if (aspect < 0.72) {
      camera.position.set(0, 0, 7.15)
      camera.fov = 43
    } else if (aspect < 1) {
      camera.position.set(0, 0, 6.65)
      camera.fov = 42
    } else if (aspect > 1.7) {
      camera.position.set(0, 0, 6.15)
      camera.fov = 40
    } else {
      camera.position.set(0, 0, 6.25)
      camera.fov = 41
    }

    camera.aspect = aspect
    camera.updateProjectionMatrix()
  }, [camera, size.height, size.width])

  return null
}

export default function App() {
  return (
    <main className="app-shell">
      <Canvas
        camera={{ position: [0, 0, 6.25], fov: 41, near: 0.1, far: 100 }}
        dpr={[1, 1.85]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
      >
        <color attach="background" args={['#030303']} />
        <ResponsiveCamera />
        <HomeOrb />
        <TrackballControls
          makeDefault
          noPan
          rotateSpeed={1.55}
          zoomSpeed={0.72}
          minDistance={4.35}
          maxDistance={9.2}
          staticMoving={false}
          dynamicDampingFactor={0.1}
        />
      </Canvas>
      <div className="brand">Memory Orb</div>
    </main>
  )
}
