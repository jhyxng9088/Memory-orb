import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const MAX_NODES = 120
const MAX_LINKS_PER_NODE = 4
const MAX_EDGES = MAX_NODES * MAX_LINKS_PER_NODE

const REPULSION_STRENGTH = 0.5
const REPULSION_SOFTENING = 0.045
const MAX_REPULSION_FORCE = 6
const SPRING_STIFFNESS = 5.4
const SPRING_DAMPING = 0.95
const BASE_REST_LENGTH = 0.68
const NODE_DAMPING = 2.6
const CENTER_OF_MASS_STIFFNESS = 0.22
const MAX_SPEED = 3.2
const SUBSTEPS = 3

function seededRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createSpawnPosition(index) {
  if (index === 0) return new THREE.Vector3(0, 0, 0)

  const direction = new THREE.Vector3(
    seededRandom(index * 3 + 1) * 2 - 1,
    seededRandom(index * 3 + 2) * 2 - 1,
    seededRandom(index * 3 + 3) * 2 - 1,
  )

  if (direction.lengthSq() < 0.0001) direction.set(1, 0, 0)
  direction.normalize()

  const radius = 0.06 + seededRandom(index * 7 + 5) * 0.12
  return direction.multiplyScalar(radius)
}

function createLineBuffer() {
  return new Float32Array(MAX_EDGES * 2 * 3)
}

function applyNodeMatrices(mesh, nodes, dummy) {
  if (!mesh) return

  mesh.count = nodes.length

  nodes.forEach((node, index) => {
    dummy.position.copy(node.position)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })

  mesh.instanceMatrix.needsUpdate = true
}

const HomeOrb = forwardRef(function HomeOrb(_, ref) {
  const nodeRef = useRef()
  const lineGeometryRef = useRef()
  const nodesRef = useRef([])
  const edgesRef = useRef([])
  const degreesRef = useRef(new Array(MAX_NODES).fill(0))
  const [nodeCount, setNodeCount] = useState(0)

  const linePositions = useMemo(() => createLineBuffer(), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(
    () => ({
      delta: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      relativeVelocity: new THREE.Vector3(),
      centerOfMass: new THREE.Vector3(),
      centerCorrection: new THREE.Vector3(),
    }),
    [],
  )

  useImperativeHandle(ref, () => ({
    addNode() {
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const index = nodes.length

      if (index >= MAX_NODES) return false

      const position = createSpawnPosition(index)
      const outwardVelocity = position.clone()

      if (outwardVelocity.lengthSq() > 0) {
        outwardVelocity.normalize().multiplyScalar(0.08)
      }

      nodes.push({
        position,
        velocity: outwardVelocity,
        force: new THREE.Vector3(),
      })

      if (index > 0) {
        const linkCount = Math.min(MAX_LINKS_PER_NODE, index)
        const candidates = Array.from({ length: index }, (_, candidateIndex) => {
          const distanceSq = nodes[candidateIndex].position.distanceToSquared(position)
          const degreePenalty = degreesRef.current[candidateIndex] * 0.42
          const variation = seededRandom(index * 97 + candidateIndex * 13) * 0.08

          return {
            candidateIndex,
            score: distanceSq * 0.55 + degreePenalty + variation,
          }
        })

        candidates
          .sort((a, b) => a.score - b.score)
          .slice(0, linkCount)
          .forEach(({ candidateIndex }, connectionIndex) => {
            const restVariation =
              0.92 + seededRandom(index * 31 + connectionIndex * 17) * 0.16

            edges.push({
              a: index,
              b: candidateIndex,
              restLength: BASE_REST_LENGTH * restVariation,
            })

            degreesRef.current[index] += 1
            degreesRef.current[candidateIndex] += 1
          })
      }

      setNodeCount(nodes.length)
      return true
    },
  }))

  useLayoutEffect(() => {
    if (nodeRef.current) nodeRef.current.count = nodeCount
    if (lineGeometryRef.current) lineGeometryRef.current.setDrawRange(0, 0)
  }, [nodeCount])

  useFrame((_, frameDelta) => {
    const nodes = nodesRef.current
    const edges = edgesRef.current

    if (nodes.length === 0) return

    const dt = Math.min(frameDelta, 1 / 30)
    const step = dt / SUBSTEPS

    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      nodes.forEach((node) => node.force.set(0, 0, 0))

      scratch.centerOfMass.set(0, 0, 0)
      nodes.forEach((node) => scratch.centerOfMass.add(node.position))
      scratch.centerOfMass.multiplyScalar(1 / nodes.length)

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const nodeA = nodes[i]
          const nodeB = nodes[j]

          scratch.delta.copy(nodeA.position).sub(nodeB.position)
          const distanceSq = scratch.delta.lengthSq() + REPULSION_SOFTENING
          const distance = Math.sqrt(distanceSq)

          if (distance < 0.0001) continue

          scratch.direction.copy(scratch.delta).multiplyScalar(1 / distance)
          const forceMagnitude = Math.min(
            REPULSION_STRENGTH / distanceSq,
            MAX_REPULSION_FORCE,
          )

          nodeA.force.addScaledVector(scratch.direction, forceMagnitude)
          nodeB.force.addScaledVector(scratch.direction, -forceMagnitude)
        }
      }

      edges.forEach((edge) => {
        const nodeA = nodes[edge.a]
        const nodeB = nodes[edge.b]

        if (!nodeA || !nodeB) return

        scratch.delta.copy(nodeB.position).sub(nodeA.position)
        const distance = Math.max(scratch.delta.length(), 0.0001)
        scratch.direction.copy(scratch.delta).multiplyScalar(1 / distance)

        const stretch = distance - edge.restLength
        const relativeSpeed = scratch.relativeVelocity
          .copy(nodeB.velocity)
          .sub(nodeA.velocity)
          .dot(scratch.direction)

        const forceMagnitude =
          SPRING_STIFFNESS * stretch + SPRING_DAMPING * relativeSpeed

        nodeA.force.addScaledVector(scratch.direction, forceMagnitude)
        nodeB.force.addScaledVector(scratch.direction, -forceMagnitude)
      })

      scratch.centerCorrection
        .copy(scratch.centerOfMass)
        .multiplyScalar(-CENTER_OF_MASS_STIFFNESS)

      const damping = Math.exp(-NODE_DAMPING * step)

      nodes.forEach((node) => {
        node.force.add(scratch.centerCorrection)
        node.velocity.addScaledVector(node.force, step)
        node.velocity.multiplyScalar(damping)

        const speed = node.velocity.length()
        if (speed > MAX_SPEED) node.velocity.multiplyScalar(MAX_SPEED / speed)

        node.position.addScaledVector(node.velocity, step)
      })
    }

    applyNodeMatrices(nodeRef.current, nodes, dummy)

    if (lineGeometryRef.current) {
      const positionAttribute = lineGeometryRef.current.attributes.position
      const array = positionAttribute.array

      edges.forEach((edge, edgeIndex) => {
        const nodeA = nodes[edge.a]
        const nodeB = nodes[edge.b]
        const offset = edgeIndex * 6

        array[offset] = nodeA.position.x
        array[offset + 1] = nodeA.position.y
        array[offset + 2] = nodeA.position.z
        array[offset + 3] = nodeB.position.x
        array[offset + 4] = nodeB.position.y
        array[offset + 5] = nodeB.position.z
      })

      positionAttribute.needsUpdate = true
      lineGeometryRef.current.setDrawRange(0, edges.length * 2)
    }
  })

  return (
    <group>
      <lineSegments>
        <bufferGeometry ref={lineGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#e8edf8"
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <instancedMesh
        ref={nodeRef}
        args={[null, null, MAX_NODES]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.04, 14, 14]} />
        <meshBasicMaterial color="#f8f9fb" toneMapped={false} />
      </instancedMesh>
    </group>
  )
})

export default HomeOrb
