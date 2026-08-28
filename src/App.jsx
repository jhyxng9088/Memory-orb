import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import HomeOrb from './components/HomeOrb.jsx'

export default function App() {
  return (
    <main className="app-shell">
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#050505']} />
        <HomeOrb />
        <OrbitControls
          enablePan={false}
          enableDamping
          dampingFactor={0.055}
          rotateSpeed={0.55}
          zoomSpeed={0.55}
          minDistance={4.3}
          maxDistance={9}
          autoRotate
          autoRotateSpeed={0.18}
        />
      </Canvas>
      <div className="brand">Memory Orb</div>
    </main>
  )
}
