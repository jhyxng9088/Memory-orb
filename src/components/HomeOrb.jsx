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

function applyMatrices(mesh, points, dummy, scale = 1) {
  if (!mesh) return

  points.forEach((point, index) => {
    dummy.position.copy(point)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })

  mesh.instanceMatrix.needsUpdate = true
}

export default function HomeOrb() {
  const nodeRef = useRef()
  const glowRef = useRef()
  const points = useMemo(() => createSpherePoints(), [])
  const connections = useMemo(() => createConnections(points), [points])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    applyMatrices(nodeRef.current, points, dummy, 1)
    applyMatrices(glowRef.current, points, dummy, 2.45)
  }, [dummy, points])

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[connections, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color="#e8edf8"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <instancedMesh ref={glowRef} args={[null, null, NODE_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[0.032, 10, 10]} />
        <meshBasicMaterial
          color="#d9e4ff"
          transparent
          opacity={0.085}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh ref={nodeRef} args={[null, null, NODE_COUNT]} frustumCulled={false}>
        <sphereGeometry args={[0.032, 12, 12]} />
        <meshBasicMaterial color="#f7f8fb" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
