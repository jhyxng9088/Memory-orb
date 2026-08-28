import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

const NODE_COUNT = 96
const RADIUS = 2.25

function createSpherePoints() {
  return Array.from({ length: NODE_COUNT }, (_, index) => {
    const y = 1 - (index / (NODE_COUNT - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = Math.PI * (3 - Math.sqrt(5)) * index

    return new THREE.Vector3(
      Math.cos(theta) * radiusAtY * RADIUS,
      y * RADIUS,
      Math.sin(theta) * radiusAtY * RADIUS,
    )
  })
}

function createConnections(points) {
  const segments = []

  points.forEach((point, index) => {
    const nearest = points
      .map((candidate, candidateIndex) => ({
        candidate,
        candidateIndex,
        distance: point.distanceToSquared(candidate),
      }))
      .filter(({ candidateIndex }) => candidateIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)

    nearest.forEach(({ candidate, candidateIndex }) => {
      if (candidateIndex > index) {
        segments.push(point.x, point.y, point.z, candidate.x, candidate.y, candidate.z)
      }
    })
  })

  return new Float32Array(segments)
}

export default function HomeOrb() {
  const meshRef = useRef()
  const points = useMemo(() => createSpherePoints(), [])
  const connections = useMemo(() => createConnections(points), [points])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    if (!meshRef.current) return

    points.forEach((point, index) => {
      dummy.position.copy(point)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(index, dummy.matrix)
    })

    meshRef.current.instanceMatrix.needsUpdate = true
  }, [dummy, points])

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[connections, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.095}
          depthWrite={false}
        />
      </lineSegments>

      <instancedMesh ref={meshRef} args={[null, null, NODE_COUNT]}>
        <sphereGeometry args={[0.032, 10, 10]} />
        <meshBasicMaterial color="#f5f5f5" />
      </instancedMesh>
    </group>
  )
}
